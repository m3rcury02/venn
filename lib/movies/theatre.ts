// Theatre mode's candidate pool (SPEC §4.2, phase 9): nowPlaying(region) union
// upcoming within a window, cached per region in movie_releases so the picker
// does not call TMDB on every render.
//
// Values below are tunable free, same argument as lib/recommend/explain.ts:
// the SQL scoring weights live in a migration because §1/§10 require plain SQL,
// but nothing here is scoring -- it is candidate sourcing, so it stays in
// TypeScript.

import { PROVIDER_NAME, provider } from "../providers";
import { cacheMovie } from "./cache";
import { createServiceClient } from "../supabase/service";

/** SPEC §4.2's "N weeks", decided this session. */
const UPCOMING_WEEKS = 4;
/** How long a region's cache is trusted before the next render re-fetches. */
const TTL_HOURS = 12;
/** Caps how many *uncached* titles one refresh will pay the two-call
 *  cacheMovie() cost for, so a cold region cannot blow a serverless request's
 *  time budget. Titles past this are simply picked up by the next refresh. */
const MAX_NEW_TITLES = 24;
/** In-flight cacheMovie() calls at once. */
const CONCURRENCY = 5;

type Db = ReturnType<typeof createServiceClient>;

export type TheatreCandidate = {
  movieId: string;
  releaseDate: string | null;
  releaseType: "theatrical" | "upcoming";
};

type Row = {
  movie_id: string;
  release_date: string | null;
  release_type: "theatrical" | "upcoming";
  fetched_at: string;
};

export async function theatreCandidates(region: string): Promise<TheatreCandidate[]> {
  const db = createServiceClient();

  const existing = await readRegion(db, region);
  if (isFresh(existing)) return existing.map(toCandidate);

  try {
    return await refresh(db, region);
  } catch {
    // TMDB down, or every call in this refresh exhausted its retries (phase 1a
    // measured ~20% ECONNRESET from some networks). The DB was not touched
    // before this point (see refresh()), so whatever was cached before this
    // render is still there -- serve it rather than failing the page.
    return existing.map(toCandidate);
  }
}

function toCandidate(row: Row): TheatreCandidate {
  return { movieId: row.movie_id, releaseDate: row.release_date, releaseType: row.release_type };
}

async function readRegion(db: Db, region: string): Promise<Row[]> {
  const { data, error } = await db
    .from("movie_releases")
    .select("movie_id, release_date, release_type, fetched_at")
    .eq("region", region);

  if (error) throw error;
  return (data as Row[] | null) ?? [];
}

function isFresh(rows: Row[]): boolean {
  if (rows.length === 0) return false;
  const newest = Math.max(...rows.map((r) => new Date(r.fetched_at).getTime()));
  return Date.now() - newest < TTL_HOURS * 60 * 60 * 1000;
}

type Wanted = { releaseType: "theatrical" | "upcoming"; releaseDate: string | null };

async function refresh(db: Db, region: string): Promise<TheatreCandidate[]> {
  const [nowPlaying, upcoming] = await Promise.all([
    provider.nowPlaying(region),
    provider.upcoming(region),
  ]);

  const windowEnd = Date.now() + UPCOMING_WEEKS * 7 * 24 * 60 * 60 * 1000;

  // Map preserves insertion order, so iterating its keys later keeps nowPlaying
  // ahead of upcoming -- which is what makes MAX_NEW_TITLES spend its budget on
  // what's actually in cinemas now rather than what's merely announced.
  const wanted = new Map<string, Wanted>();
  for (const item of nowPlaying) {
    wanted.set(item.externalId, { releaseType: "theatrical", releaseDate: item.releaseDate });
  }
  for (const item of upcoming) {
    if (wanted.has(item.externalId)) continue;
    // No date means no way to tell it's inside the window -- drop it, unlike a
    // nowPlaying title with no date, which is kept because it's already showing.
    if (!item.releaseDate) continue;
    if (new Date(item.releaseDate).getTime() > windowEnd) continue;
    wanted.set(item.externalId, { releaseType: "upcoming", releaseDate: item.releaseDate });
  }

  const externalIds = [...wanted.keys()];

  const { data: known, error: lookupError } = await db
    .from("movie_external_ids")
    .select("external_id, movie_id")
    .eq("provider", PROVIDER_NAME)
    .in("external_id", externalIds.length > 0 ? externalIds : [""]);
  if (lookupError) throw lookupError;

  const resolved = new Map<string, string>(
    ((known as { external_id: string; movie_id: string }[] | null) ?? []).map((r) => [
      r.external_id,
      r.movie_id,
    ]),
  );

  const uncached = externalIds.filter((id) => !resolved.has(id));
  const capped = uncached.slice(0, MAX_NEW_TITLES);
  const truncated = uncached.length > capped.length;

  await mapLimit(capped, CONCURRENCY, async (externalId) => {
    try {
      resolved.set(externalId, await cacheMovie(externalId));
    } catch {
      // Leave unresolved -- picked up by the next refresh, same as a
      // cap-skipped title.
    }
  });

  // (movie_id, release_type) is the table's key, not externalId -- dedupe on
  // that in case two external ids ever resolved to the same cached movie.
  const rowsByKey = new Map<string, Row>();
  const fetchedAt = truncated
    ? // Stamped stale on arrival: a truncated refresh has more titles it
      // couldn't resolve this round, and stamping `now()` would mark the
      // region fresh for the full TTL, silently scoring only the titles that
      // made the cap until it happens to expire. One minute of freshness is
      // enough to answer this render; the next render tries the rest.
      new Date(Date.now() - TTL_HOURS * 60 * 60 * 1000 + 60 * 1000).toISOString()
    : new Date().toISOString();

  for (const [externalId, { releaseType, releaseDate }] of wanted) {
    const movieId = resolved.get(externalId);
    if (!movieId) continue;
    rowsByKey.set(`${movieId}:${releaseType}`, {
      movie_id: movieId,
      release_date: releaseDate,
      release_type: releaseType,
      fetched_at: fetchedAt,
    });
  }

  const rows = [...rowsByKey.values()];

  // Delete-then-insert, not an upsert-plus-diff: this refresh just recomputed
  // the *complete* wanted set for the region, so anything not in `rows` --
  // most importantly a film that has left cinemas and dropped out of
  // nowPlaying -- has to go, or the pool grows monotonically and a `max(fetched_at)`
  // freshness check would keep reporting "fresh" over titles that closed
  // months ago. Two calls, not one transaction: phase 1a's precedent for this
  // cache (cacheMovie's write order) is that a partial write here is a
  // harmless leak at this scale, not worth an RPC.
  const { error: deleteError } = await db.from("movie_releases").delete().eq("region", region);
  if (deleteError) throw deleteError;

  if (rows.length > 0) {
    const { error: insertError } = await db
      .from("movie_releases")
      .insert(rows.map((r) => ({ ...r, region })));
    if (insertError) throw insertError;
  }

  return rows.map(toCandidate);
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
