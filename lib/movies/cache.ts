// Write-through cache for the catalog (SPEC §3): "movies and movie_tags are a
// local cache. Fetch once on first sighting, never per read."
//
// This is the only place a provider record becomes internal rows, and the only
// place `movies.id` is minted.

import { PROVIDER_NAME, provider } from "../providers";
import type { Movie, Tag } from "../providers/types";
import { assertRateLimit } from "../rate-limit";
import { createServiceClient } from "../supabase/service";

type Db = ReturnType<typeof createServiceClient>;

/**
 * Resolves a provider id to the internal `movies.id`, fetching and caching the
 * movie the first time it is seen. Callers hold external ids; every foreign key
 * in the schema wants this uuid.
 */
export async function cacheMovie(externalId: string): Promise<string> {
  const db = createServiceClient();

  const cached = await lookup(db, PROVIDER_NAME, externalId);
  if (cached) return cached;

  const [movie, tags] = await Promise.all([
    provider.getMovie(externalId),
    provider.getTags(externalId),
  ]);

  return persistMovie(db, movie, tags);
}

/**
 * cacheMovie for a request a user started with an external id they chose:
 * add-to-list, onboarding votes, import fixes, /movies/external/<id>. Each of
 * those can name any title on TMDB, and an uncached one costs two provider
 * calls. So the "catalog" budget is charged only on a cache miss: re-adding
 * cached titles is free, and a script walking TMDB's id space is not.
 *
 * Throws RateLimitedError past the budget. Every caller already catches a
 * cacheMovie failure and shows its own "couldn't load" message.
 */
export async function cacheMovieForUser(
  supabase: Parameters<typeof assertRateLimit>[0],
  externalId: string,
): Promise<string> {
  const cached = await lookup(createServiceClient(), PROVIDER_NAME, externalId);
  if (cached) return cached;

  await assertRateLimit(supabase, "catalog");
  return cacheMovie(externalId);
}

/**
 * Caches a full provider record the caller already resolved. Imports use this
 * after findByImdbId so the detail call made by that lookup is not repeated.
 */
export async function cacheResolvedMovie(movie: Movie): Promise<string> {
  const db = createServiceClient();
  const cached = await lookup(db, PROVIDER_NAME, movie.externalId);
  if (cached) return cached;

  const tags = await provider.getTags(movie.externalId);
  return persistMovie(db, movie, tags);
}

/**
 * Resolves and caches an IMDb id, recording the exact IMDb mapping so repeated
 * imports skip the provider lookup entirely.
 */
export async function cacheMovieByImdbId(imdbId: string): Promise<string | null> {
  const normalized = imdbId.trim().toLowerCase();
  if (!/^tt\d+$/.test(normalized)) return null;

  const db = createServiceClient();
  const cached = await lookup(db, "imdb", normalized);
  if (cached) return cached;

  const movie = await provider.findByImdbId(normalized);
  if (!movie) return null;

  const movieId = await cacheResolvedMovie(movie);
  const { error } = await db.from("movie_external_ids").insert({
    movie_id: movieId,
    provider: "imdb",
    external_id: normalized,
  });

  if (!error) return movieId;
  if (error.code !== "23505") throw error;

  return (await lookup(db, "imdb", normalized)) ?? movieId;
}

/**
 * Re-fetches a cached title and overwrites its catalog rows in place, keeping
 * its `movies.id` so every list, rating and night that points at it survives.
 * TMDB's API terms (section 1.C) forbid caching its data for more than six
 * months; lib/movies/refresh.ts calls this before a row gets that old.
 */
export async function refreshMovie(movieId: string, externalId: string): Promise<void> {
  const db = createServiceClient();

  const [movie, tags] = await Promise.all([
    provider.getMovie(externalId),
    provider.getTags(externalId),
  ]);

  // Tags first, the movies row last -- persistMovie's commit-marker idea again.
  // `fetched_at` is what marks this title as done, so if anything below throws
  // the row stays old and tomorrow's run retries it. Updating the movie first
  // would stamp it fresh over tags that never got replaced.
  //
  // Add-then-remove, not delete-then-insert: the recommender reads movie_tags
  // at any moment, and a delete first would score this title with no tags at
  // all until the insert landed.
  const tagIds = await upsertTags(db, tags);

  if (tagIds.length > 0) {
    const { error } = await db
      .from("movie_tags")
      .upsert(
        tagIds.map((tagId) => ({ movie_id: movieId, tag_id: tagId })),
        { onConflict: "movie_id,tag_id", ignoreDuplicates: true },
      );
    if (error) throw error;
  }

  // Drops tags TMDB no longer lists for this title (a removed keyword, a
  // cast change). With no tags at all, every existing row goes.
  let stale = db.from("movie_tags").delete().eq("movie_id", movieId);
  if (tagIds.length > 0) stale = stale.not("tag_id", "in", `(${tagIds.join(",")})`);
  const { error: staleError } = await stale;
  if (staleError) throw staleError;

  const { error } = await db
    .from("movies")
    .update(movieColumns(movie))
    .eq("id", movieId);
  if (error) throw error;
}

async function persistMovie(db: Db, movie: Movie, tags: Tag[]): Promise<string> {
  const movieId = await insertMovie(db, movie);
  await insertTags(db, movieId, tags);

  // Written last on purpose. This row is the only lookup path, so it is the
  // commit marker: failing before it leaves an orphaned movies row and the next
  // call re-fetches cleanly. The reverse order is what breaks -- a mapping with
  // fetched_at set but no tags, which nothing would ever re-fetch.
  const { error } = await db.from("movie_external_ids").insert({
    movie_id: movieId,
    provider: PROVIDER_NAME,
    external_id: movie.externalId,
  });

  if (error) {
    // 23505: a concurrent call cached the same movie first. Its mapping won, so
    // ours is an orphan -- return the id that actually got mapped.
    if (error.code !== "23505") throw error;

    const winner = await lookup(db, PROVIDER_NAME, movie.externalId);
    if (!winner) throw error;
    return winner;
  }

  return movieId;
}

async function lookup(
  db: Db,
  providerName: string,
  externalId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("movie_external_ids")
    .select("movie_id")
    .eq("provider", providerName)
    .eq("external_id", externalId)
    .maybeSingle();

  if (error) throw error;
  return data?.movie_id ?? null;
}

async function insertMovie(db: Db, movie: Movie): Promise<string> {
  const { data, error } = await db
    .from("movies")
    .insert(movieColumns(movie))
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

// Shared by insertMovie and refreshMovie, so a refresh rewrites exactly the
// columns a first fetch writes and the two can't drift apart.
function movieColumns(movie: Movie) {
  const now = new Date().toISOString();
  return {
    title: movie.title,
    original_title: movie.originalTitle,
    year: movie.year,
    poster_path: movie.posterPath,
    backdrop_path: movie.backdropPath,
    runtime: movie.runtime,
    overview: movie.overview,
    // rating_external is numeric(3,1) -- Postgres rounds 8.456 to 8.5. That
    // truncation is intended; do not "fix" it by rounding here first.
    rating_external: movie.ratingExternal,
    release_date: movie.releaseDate,
    media_type: movie.mediaType,
    trailer_key: movie.trailerKey,
    // Stamped whenever a movie row is minted or refreshed, because getMovie
    // always asks for videos. A null key here therefore means "no trailer exists", not
    // "not looked yet" -- which is exactly what the backfill needs to skip it.
    trailer_fetched_at: now,
    // Explicit rather than left to the column default, because refreshMovie
    // sends this same object as an UPDATE, and a default only fires on INSERT.
    // This is the timestamp lib/movies/refresh.ts ages against TMDB's 6-month
    // limit.
    fetched_at: now,
  };
}

async function insertTags(db: Db, movieId: string, tags: Tag[]): Promise<void> {
  const tagIds = await upsertTags(db, tags);
  if (tagIds.length === 0) return;

  // weight keeps its column default of 1: §4.1 applies the per-type weight
  // (genre x3, person x2, keyword x1) at scoring time, read from tags.tag_type.
  const { error } = await db
    .from("movie_tags")
    .insert(tagIds.map((tagId) => ({ movie_id: movieId, tag_id: tagId })));

  if (error) throw error;
}

async function upsertTags(db: Db, tags: Tag[]): Promise<number[]> {
  if (tags.length === 0) return [];

  // Tags are shared across movies, so this is an upsert; insertTags' movie_tags
  // insert is not. toTags() dedupes, which it has to -- a repeated (tag_type, tag_value)
  // in one batch would trip "ON CONFLICT DO UPDATE cannot affect row a second
  // time".
  //
  // fetched_at rides the upsert so an existing tag is re-stamped too: TMDB just
  // sent this value again. prune_catalog (20260924120000_catalog_refresh.sql)
  // relies on that to tell a live tag from one nothing uses any more.
  const fetchedAt = new Date().toISOString();
  const { data: rows, error } = await db
    .from("tags")
    .upsert(
      tags.map((tag) => ({
        tag_type: tag.type,
        tag_value: tag.value,
        fetched_at: fetchedAt,
      })),
      { onConflict: "tag_type,tag_value" },
    )
    .select("id");

  if (error) throw error;
  return rows.map((row) => row.id);
}
