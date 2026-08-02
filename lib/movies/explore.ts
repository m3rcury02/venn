// Explore (post-phase-9 feature): the /explore trailer feed's candidate pool.
//
// Two sources, in order:
//   1. theatreCandidates(region) -- the in-cinemas ∪ upcoming titles from phase
//      9's release cache, which is already TTL-cached and is the set most
//      likely to have a trailer.
//   2. TMDB popular, one page per feed page once the releases are exhausted.
//
// The pool is always cached: every card carries an internal `movies.id`, so the
// client never holds a provider id it cannot vote on.

import type { Hype, Rating } from "@/app/status/actions";
import { PROVIDER_NAME, provider } from "../providers";
import type { MovieSummary } from "../providers/types";
import { cacheMovie } from "./cache";
import { theatreCandidates } from "./theatre";
import { createServiceClient } from "../supabase/service";

/** Cards per feed page. */
const PAGE_SIZE = 10;
/** 2 TMDB calls each (detail+tags via cacheMovie); bounds a cold request. */
const MAX_NEW_TITLES = 12;
/** In-flight cacheMovie() calls at once -- matches lib/movies/theatre.ts. */
const CONCURRENCY = 5;

type Db = ReturnType<typeof createServiceClient>;

export type ExploreCard = {
  movieId: string; // internal uuid -- the pool is always cached
  /** Provider id, needed by addToList/addWatchedToList in the card actions. */
  externalId: string;
  title: string;
  year: number | null;
  runtime: number | null;
  overview: string | null;
  posterUrl: string | null; // provider.getImageUrl(path, "w500")
  backdropUrl: string | null; // provider.getImageUrl(path, "w780")
  trailerKey: string | null;
  watched: boolean;
  rating: Rating | null;
  hype: Hype | null;
  isInList: boolean;
};

type MovieRow = {
  id: string;
  title: string;
  year: number | null;
  runtime: number | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  trailer_key: string | null;
  trailer_fetched_at: string | null;
};

type StatusRow = {
  movie_id: string;
  watched: boolean;
  rating: Rating | null;
  hype: Hype | null;
};

export async function exploreFeed(
  userId: string,
  region: string,
  page: number,
): Promise<ExploreCard[]> {
  const db = createServiceClient();
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;

  // ---------------------------------------------------------- the pool

  // Source 1 -- releases. theatreCandidates() itself never throws (it catches
  // its own refresh), but its DB reads could; a feed page is not worth a 500.
  let releaseIds: string[] = [];
  try {
    releaseIds = (await theatreCandidates(region)).map((c) => c.movieId);
  } catch {
    releaseIds = [];
  }

  // Both sources yield (movieId, externalId) pairs: releases resolve theirs
  // via the batched mapping query below, popular overflow resolves them while
  // caching, and the trailer backfill and the card actions both need the
  // provider id.
  let pool: { movieId: string; externalId: string }[] = [];

  const releasePages = Math.ceil(releaseIds.length / PAGE_SIZE);
  if (safePage <= releasePages) {
    const pageIds = releaseIds.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    const { data: mappings, error } = await db
      .from("movie_external_ids")
      .select("external_id, movie_id")
      .eq("provider", PROVIDER_NAME)
      .in("movie_id", pageIds.length > 0 ? pageIds : [""]);
    if (error) throw error;
    const externalIdByMovieId = new Map(
      ((mappings as { external_id: string; movie_id: string }[] | null) ?? []).map(
        (m) => [m.movie_id, m.external_id],
      ),
    );
    pool = pageIds.flatMap((movieId) => {
      const externalId = externalIdByMovieId.get(movieId);
      return externalId ? [{ movieId, externalId }] : [];
    });
  } else {
    // Source 2 -- popular overflow. The TMDB page restarts after the releases
    // span: the feed pages past `releasePages` are popular page 1, 2, ... so
    // the most popular titles are the first overflow, not skipped forever.
    pool = await popularOverflow(db, region, safePage - releasePages);
  }

  if (pool.length === 0) return [];
  const poolIds = pool.map((p) => p.movieId);

  // ---------------------------------------------------- status & list

  const { data: statuses, error: statusError } = await db
    .from("user_movie_status")
    .select("movie_id, watched, rating, hype")
    .eq("user_id", userId)
    .in("movie_id", poolIds);
  if (statusError) throw statusError;

  // A *cleared* vote (row exists, both columns null, not watched) must not
  // exclude -- it means the user deliberately un-voted. Only a live vote
  // (watched, or either vote column set) removes a title from the feed.
  const votedMovieIds = new Set(
    ((statuses as StatusRow[] | null) ?? [])
      .filter((s) => s.watched || s.rating != null || s.hype != null)
      .map((s) => s.movie_id),
  );
  const watchable = poolIds.filter((id) => !votedMovieIds.has(id));
  if (watchable.length === 0) return [];

  // One page of watchable cards; leftovers stay on TMDB's side and are never
  // served, which is fine -- the feed dedupes client-side and pages are cheap.
  const pageIds = watchable.slice(0, PAGE_SIZE);

  const { data: movies, error: moviesError } = await db
    .from("movies")
    .select(
      "id, title, year, runtime, overview, poster_path, backdrop_path, trailer_key, trailer_fetched_at",
    )
    .in("id", pageIds);
  if (moviesError) throw moviesError;

  const movieById = new Map(
    ((movies as MovieRow[] | null) ?? []).map((m) => [m.id, m]),
  );

  const { data: defaultList, error: listError } = await db
    .from("lists")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  if (listError) throw listError;

  const listedMovieIds = new Set<string>();
  if (defaultList) {
    const { data: items, error: itemsError } = await db
      .from("list_items")
      .select("movie_id")
      .eq("list_id", defaultList.id)
      .in("movie_id", pageIds);
    if (itemsError) throw itemsError;
    for (const item of (items as { movie_id: string }[] | null) ?? []) {
      listedMovieIds.add(item.movie_id);
    }
  }

  // ------------------------------------------------------ trailer backfill

  // Only pre-existing rows reach this: insertMovie stamps trailer_fetched_at on
  // every mint, so null means "cached before Explore existed". Backfill those
  // in place so the next pass serves them from the catalog. Bound by
  // MAX_NEW_TITLES too: a page of 10 can't exceed it today, but the cap is the
  // same cold-request budget the new-title path spends, and one knob should
  // gate both. A failure leaves the title in the feed with no trailer rather
  // than dropping it.
  const needsBackfill = pageIds
    .filter((id) => movieById.get(id)?.trailer_fetched_at == null)
    .slice(0, MAX_NEW_TITLES);

  const externalIdByMovieId = new Map(pool.map((p) => [p.movieId, p.externalId]));

  await mapLimit(needsBackfill, CONCURRENCY, async (movieId) => {
    const externalId = externalIdByMovieId.get(movieId);
    if (!externalId) return;
    try {
      const trailerKey = await provider.getTrailerKey(externalId);
      await db
        .from("movies")
        .update({
          trailer_key: trailerKey,
          trailer_fetched_at: new Date().toISOString(),
        })
        .eq("id", movieId);
    } catch {
      // Unlooked titles re-query next pass; looked-but-failed titles stay in
      // the feed with trailerKey: null. Both are the correct degradation.
    }
  });

  const statusByMovieId = new Map(
    ((statuses as StatusRow[] | null) ?? []).map((s) => [s.movie_id, s]),
  );

  return pageIds.flatMap((movieId) => {
    const movie = movieById.get(movieId);
    if (!movie) return []; // pool always resolves; guard against races anyway
    const status = statusByMovieId.get(movieId);
    const externalId = externalIdByMovieId.get(movieId) ?? "";
    return [
      {
        movieId,
        externalId,
        title: movie.title,
        year: movie.year,
        runtime: movie.runtime,
        overview: movie.overview,
        posterUrl: movie.poster_path
          ? provider.getImageUrl(movie.poster_path, "w500")
          : null,
        backdropUrl: movie.backdrop_path
          ? provider.getImageUrl(movie.backdrop_path, "w780")
          : null,
        trailerKey: movie.trailer_key,
        watched: status?.watched ?? false,
        rating: status?.rating ?? null,
        hype: status?.hype ?? null,
        isInList: listedMovieIds.has(movieId),
      },
    ];
  });
}

/**
 * One TMDB popular page, resolved to internal ids. Uncached titles are cached
 * (capped) exactly the way loadPopularOnboarding does it -- one batched
 * mapping query, then cacheMovie per miss. Returns [] rather than throwing:
 * popular is the overflow source, and a release-pool page is still served.
 */
async function popularOverflow(
  db: Db,
  region: string,
  tmdbPage: number,
): Promise<{ movieId: string; externalId: string }[]> {
  let results: MovieSummary[];
  try {
    results = await provider.popular(region, tmdbPage);
  } catch {
    return [];
  }
  if (results.length === 0) return [];

  const { data: mappings, error: mappingError } = await db
    .from("movie_external_ids")
    .select("external_id, movie_id")
    .eq("provider", PROVIDER_NAME)
    .in(
      "external_id",
      results.map((movie) => movie.externalId),
    );
  if (mappingError) throw mappingError;

  const resolved = new Map(
    ((mappings as { external_id: string; movie_id: string }[] | null) ?? []).map(
      (m) => [m.external_id, m.movie_id],
    ),
  );

  const uncached = results
    .map((movie) => movie.externalId)
    .filter((id) => !resolved.has(id))
    .slice(0, MAX_NEW_TITLES);

  await mapLimit(uncached, CONCURRENCY, async (externalId) => {
    try {
      resolved.set(externalId, await cacheMovie(externalId));
    } catch {
      // Leave unresolved -- the title is simply absent from this page, and the
      // next visit to the same page tries it again.
    }
  });

  return results.flatMap((movie) => {
    const movieId = resolved.get(movie.externalId);
    return movieId ? [{ movieId, externalId: movie.externalId }] : [];
  });
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
