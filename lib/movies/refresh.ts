// Keeps the catalog cache inside TMDB's 6-month limit. TMDB's API Terms of
// Use, section 1.C, forbid you to "Cache, for longer than 6 months, any
// information obtained through or from TMDB or the TMDB APIs." Phase 1a cached
// every title forever; app/api/cron/refresh-catalog calls this once a day.
//
// Two jobs:
//   * re-fetch every title whose `movies.fetched_at` is past REFRESH_AFTER_DAYS,
//     oldest first, through refreshMovie (lib/movies/cache.ts);
//   * call prune_catalog (20260924120000_catalog_refresh.sql) to delete the
//     TMDB-derived rows nothing can refresh: stale theatre releases, unmapped
//     orphan movies, and tags no title uses any more.

import { PROVIDER_NAME } from "../providers";
import { refreshMovie } from "./cache";
import { createServiceClient } from "../supabase/service";

/** Refresh at 150 days, a month inside TMDB's 180. The month is slack for a
 *  TMDB outage, a run that fails, or a backlog bigger than one day's BATCH. */
const REFRESH_AFTER_DAYS = 150;
/** Titles per run. Each costs two TMDB calls (getMovie and getTags), so a run
 *  makes at most 300. At one run a day, the 30 days of slack refresh up to
 *  4,500 titles, and a steady state keeps up with a catalog of about
 *  150 x 150 = 22,500 titles. Past that, raise this or run more often. */
const BATCH = 150;
/** refreshMovie calls in flight at once, so up to 10 TMDB requests. Same
 *  value lib/movies/theatre.ts uses for its cacheMovie calls. */
const CONCURRENCY = 5;

export type RefreshReport = {
  /** Titles re-fetched and rewritten. */
  refreshed: number;
  /** Titles TMDB answered 404 for: removed or merged on TMDB's side. Left in
   *  place, because deleting the row would cascade into users' lists and
   *  ratings. They stay the oldest rows, so every run retries them first. */
  gone: string[];
  /** Titles that failed for any other reason (network, 5xx). Retried
   *  tomorrow. */
  failed: number;
  /** True when this run filled BATCH, so there may be more stale titles. */
  more: boolean;
  /** prune_catalog's row counts. */
  pruned: { releases: number; orphan_movies: number; orphan_tags: number };
};

type StaleRow = {
  id: string;
  movie_external_ids: { external_id: string }[];
};

/**
 * `staleBefore` defaults to REFRESH_AFTER_DAYS ago. It is a parameter so a
 * smoke script can pass `new Date()` and exercise a full refresh against a
 * catalog that isn't old yet; the cron route never passes it.
 */
export async function refreshStaleCatalog(
  staleBefore = new Date(Date.now() - REFRESH_AFTER_DAYS * 24 * 60 * 60 * 1000),
): Promise<RefreshReport> {
  const db = createServiceClient();
  const cutoff = staleBefore.toISOString();

  // !inner on the embed, so unmapped orphans (no movie_external_ids row) are
  // excluded here; they can't be re-fetched without an external id, and
  // prune_catalog deletes them below instead. PostgREST types the embed as an
  // array; (movie_id, provider) is unique, so it holds at most one row.
  const { data, error } = await db
    .from("movies")
    .select("id, movie_external_ids!inner(external_id)")
    .eq("movie_external_ids.provider", PROVIDER_NAME)
    .lt("fetched_at", cutoff)
    .order("fetched_at", { ascending: true })
    .limit(BATCH);

  if (error) throw error;
  const stale = (data as StaleRow[] | null) ?? [];

  let refreshed = 0;
  let failed = 0;
  const gone: string[] = [];

  await mapLimit(stale, CONCURRENCY, async (row) => {
    const externalId = row.movie_external_ids[0]?.external_id;
    if (!externalId) return;

    try {
      await refreshMovie(row.id, externalId);
      refreshed++;
    } catch (err) {
      // lib/providers/tmdb.ts throws "TMDB <status> <text> on <path>" for any
      // HTTP error, and never retries one -- so a 404 here is TMDB's answer,
      // not a flaky connection.
      if (err instanceof Error && err.message.startsWith("TMDB 404")) {
        gone.push(externalId);
      } else {
        failed++;
        console.error("refresh-catalog: refresh failed", externalId, err);
      }
    }
  });

  if (gone.length > 0) {
    // Loud on purpose. These rows will pass the 6-month limit if nothing is
    // done about them, and there is no automatic answer: see
    // docs/DECISIONS.md, "TMDB's 6-month cache limit".
    console.error("refresh-catalog: TMDB returned 404 for", gone);
  }

  const { data: pruned, error: pruneError } = await db.rpc("prune_catalog", {
    p_stale_before: cutoff,
  });
  if (pruneError) throw pruneError;

  return {
    refreshed,
    gone,
    failed,
    more: stale.length === BATCH,
    pruned: pruned as RefreshReport["pruned"],
  };
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
