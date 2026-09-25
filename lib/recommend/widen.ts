// SPEC §4.2's widen step, home mode only (theatre mode's widen stays
// deferred, unchanged from phase 9's own note on the subject).
//
// widen_seeds (supabase/migrations/20260809120000_widen_candidate_pool.sql)
// does the part that has to run with elevated privilege: counting candidates
// past the watched-exclusion, and picking seeds from present members'
// ratings, both of which need to read other present members' rows that
// user_movie_status's RLS otherwise keeps closed. Everything after that --
// calling the provider and caching misses -- is exactly the shape
// lib/movies/explore.ts's popularOverflow already uses, so it is copied here
// rather than re-derived.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PROVIDER_NAME, provider } from "../providers";
import type { MovieSummary } from "../providers/types";
import { cacheMovie } from "../movies/cache";
import { createServiceClient } from "../supabase/service";

/** §4.2's "fewer than ~10 candidates." */
export const WIDEN_THRESHOLD = 10;
/** 2 TMDB calls each (detail+tags via cacheMovie); bounds a cold request --
 *  same budget lib/movies/explore.ts and lib/movies/theatre.ts spend. */
const MAX_NEW_TITLES = 12;
/** In-flight cacheMovie() calls at once -- matches lib/movies/theatre.ts. */
const CONCURRENCY = 5;

type WidenSeeds = {
  candidate_count: number;
  seed_external_ids: string[];
};

/**
 * Extra movie ids to pass as recommend_movies' p_extra when the group's own
 * list pool has thinned out. Never a title already on the group list: those
 * are scored anyway, and would wrongly read "Not on your lists yet". Returns [] when the pool is still
 * wide enough, when nobody present has a positive-rated list film to seed
 * from, or when TMDB is unreachable -- widening degrading to today's
 * behaviour, not failing the picker, mirrors theatreCandidates' precedent
 * (lib/movies/theatre.ts:46-55).
 */
export async function widenCandidates(
  supabase: SupabaseClient,
  groupId: string,
  present: string[],
  exclude: string[],
): Promise<string[]> {
  const { data, error } = await supabase.rpc("widen_seeds", {
    p_group_id: groupId,
    p_present: present,
    p_exclude: exclude,
  });
  if (error) return [];

  // returns table(...) comes back as an array of one row, not an object --
  // same shape as get_movie_vote_percentages (app/movies/[id]/page.tsx:151-157).
  const seeds = (data as unknown as WidenSeeds[] | null)?.[0];
  if (!seeds || seeds.candidate_count >= WIDEN_THRESHOLD) return [];
  if (seeds.seed_external_ids.length === 0) return [];

  let recommended: MovieSummary[];
  try {
    const results = await Promise.all(
      seeds.seed_external_ids.map((id) => provider.recommendations(id)),
    );
    recommended = results.flat();
  } catch {
    return [];
  }

  const seedIds = new Set(seeds.seed_external_ids);
  const externalIds = [
    ...new Set(
      recommended.map((m) => m.externalId).filter((id) => !seedIds.has(id)),
    ),
  ];
  if (externalIds.length === 0) return [];

  const db = createServiceClient();
  const { data: mappings, error: mappingError } = await db
    .from("movie_external_ids")
    .select("external_id, movie_id")
    .eq("provider", PROVIDER_NAME)
    .in("external_id", externalIds);
  if (mappingError) return [];

  const resolved = new Map(
    ((mappings as { external_id: string; movie_id: string }[] | null) ?? []).map(
      (m) => [m.external_id, m.movie_id],
    ),
  );

  const uncached = externalIds.filter((id) => !resolved.has(id)).slice(0, MAX_NEW_TITLES);
  await mapLimit(uncached, CONCURRENCY, async (externalId) => {
    try {
      resolved.set(externalId, await cacheMovie(externalId));
    } catch {
      // Dropped for this round -- the next night the group opens re-resolves it.
    }
  });

  const excludeSet = new Set(exclude);
  const widened = [
    ...new Set(
      externalIds.flatMap((externalId) => {
        const movieId = resolved.get(externalId);
        return movieId && !excludeSet.has(movieId) ? [movieId] : [];
      }),
    ),
  ];
  if (widened.length === 0) return [];

  // Which of these are already on the group list, asked about just these ids
  // (a few dozen at most) rather than reading the whole list, which PostgREST
  // would cap at max_rows.
  const { data: onList, error: onListError } = await supabase
    .from("list_items")
    .select("movie_id, lists!inner(owner_group_id)")
    .eq("lists.owner_group_id", groupId)
    .in("movie_id", widened);
  if (onListError) return [];

  const listed = new Set(((onList as { movie_id: string }[] | null) ?? []).map((r) => r.movie_id));
  return widened.filter((movieId) => !listed.has(movieId));
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
