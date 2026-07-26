// The resolution engine behind SPEC §5 steps 3-6, shared by every ingest
// entry point. Phase 5 built this inside app/api/ingest/route.ts, the token
// path; phase 6 adds app/share/route.ts, the cookie path. The two differ only
// in how they learn the user id -- everything below runs identically once
// they have one, so it lives here rather than in either route.
//
// §5's governing rule shapes every branch here: "Never guess. A silent wrong
// add is worse than a badge." Auto-resolution fires only when the evidence
// names exactly one film; everything else lands in the Inbox.

import { extractCandidates, type Candidate } from "@/lib/ingest/extract";
import { cacheMovie } from "@/lib/movies/cache";
import { provider } from "@/lib/providers";
import { createServiceClient } from "@/lib/supabase/service";

export type Db = ReturnType<typeof createServiceClient>;

/**
 * §5 step 6 caps the disambiguation set. Three is what fits the Inbox without
 * scrolling, and each one costs 2 TMDB calls to cache.
 */
const MAX_CANDIDATES = 3;

/**
 * How many extracted candidates to actually resolve before giving up. The first
 * that produces anything wins; without a cap, a noisy share would fire a
 * provider search per Title Case run in it.
 */
const MAX_ATTEMPTS = 3;

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Resolves one candidate. Returns a single movie id when the evidence is
 * unambiguous (§5 step 5), a candidate list when it is not (step 6), or null
 * when this candidate found nothing at all and the next should be tried.
 */
async function resolve(
  candidate: Candidate,
  region: string,
): Promise<{ resolved: string } | { candidates: string[] } | null> {
  // A url names one film. Both id kinds are high-confidence by construction,
  // which is the whole reason §5 puts them first.
  if (candidate.kind === "external-id") {
    return { resolved: await cacheMovie(candidate.value) };
  }

  if (candidate.kind === "imdb-id") {
    const movie = await provider.findByImdbId(candidate.value);
    return movie ? { resolved: await cacheMovie(movie.externalId) } : null;
  }

  const results = await provider.search(candidate.value, region);
  if (results.length === 0) return null;

  // The bar for auto-adding from free text: exactly one result whose title IS
  // the query. Two films sharing a title (a remake, which is common) fails this
  // and goes to the Inbox, which is the correct outcome -- picking either would
  // be a guess.
  const exact = results.filter(
    (result) => normalize(result.title) === normalize(candidate.value),
  );
  if (exact.length === 1) {
    return { resolved: await cacheMovie(exact[0].externalId) };
  }

  // Caching can fail per title -- phase 1a measured TMDB resetting roughly one
  // connection in five. Keep the candidates that succeeded rather than sinking
  // the whole row for one bad call.
  const cached = await Promise.allSettled(
    results.slice(0, MAX_CANDIDATES).map((result) => cacheMovie(result.externalId)),
  );

  const candidates = cached
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);

  return candidates.length > 0 ? { candidates } : null;
}

/**
 * §5 step 5: a resolved share lands on the user's default list.
 *
 * Throws rather than returning quietly on failure, and that matters: the caller
 * marks the row `resolved` only if this returns, so a share that could not be
 * added stays `pending` instead of claiming to be on a list it never reached.
 * An earlier version swallowed both errors here and did exactly that -- the
 * missing service_role grant it hid is now in the phase 5 migration.
 */
async function addToDefaultList(db: Db, userId: string, movieId: string) {
  const { data: list, error: listError } = await db
    .from("lists")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("is_default", true)
    .single();

  if (listError) throw listError;

  // service_role bypasses list_items_insert_via_list, so the scoping above --
  // owner_user_id = the token's user -- is the only enforcement on this write.
  // That is a third departure from phase 1b's "mutations run as the
  // authenticated user", and it is forced: there is no session here to run as.
  // added_by is the token's user for the same reason phase 3 pinned that column
  // in the policy -- it is what makes "who added what" true.
  const { error } = await db
    .from("list_items")
    .insert({ list_id: list.id, movie_id: movieId, added_by: userId });

  // 23505: already on the list. That is the state the share asked for, so it is
  // success -- exactly as phase 1b decided for addToList.
  if (error && error.code !== "23505") throw error;
}

/**
 * Whether the row is still awaiting resolution.
 *
 * The row is visible in the Inbox from the moment the endpoint answers, while
 * the provider calls below are still in flight for seconds. Without this the
 * user can Dismiss a junk share and watch it turn up on their list two seconds
 * later -- the silent wrong add §5 exists to prevent, arriving from the one
 * direction a sequential test never sees.
 */
async function stillPending(db: Db, rowId: string): Promise<boolean> {
  const { data } = await db
    .from("ingest_inbox")
    .select("status")
    .eq("id", rowId)
    .maybeSingle();

  return data?.status === "pending";
}

/**
 * §5 steps 3-6. Runs after the response, so nothing here may throw into the
 * caller -- and nothing here may *lose* the row either: every failure path
 * leaves it `pending`, which is the state the Inbox exists to drain.
 */
export async function resolveInBackground(
  db: Db,
  rowId: string,
  userId: string,
  text: string,
) {
  try {
    const { data: profile } = await db
      .from("profiles")
      .select("region")
      .eq("id", userId)
      .maybeSingle();

    const region = profile?.region ?? "IN";

    for (const candidate of extractCandidates(text).slice(0, MAX_ATTEMPTS)) {
      const outcome = await resolve(candidate, region);
      if (!outcome) continue;

      // Checked here rather than only in the update's WHERE: by the time the
      // update runs the movie is already on the list, so a dismissal caught
      // there would leave the user with an item they rejected. This narrows the
      // window from a provider round trip to a single database one.
      if (!(await stillPending(db, rowId))) return;

      if ("resolved" in outcome) {
        await addToDefaultList(db, userId, outcome.resolved);

        // The status guard stays as well, for the residual window between the
        // check above and here. If a dismissal lands inside it the row keeps
        // its `rejected` status and the user has one stray list item -- visible
        // and removable, rather than a row whose status is a lie.
        await db
          .from("ingest_inbox")
          .update({ status: "resolved", resolved_movie_id: outcome.resolved })
          .eq("id", rowId)
          .eq("status", "pending");
        return;
      }

      await db
        .from("ingest_inbox")
        .update({ candidate_movie_ids: outcome.candidates })
        .eq("id", rowId)
        .eq("status", "pending");
      return;
    }
  } catch (error) {
    // Swallowed on purpose. The row is already durable and already `pending`,
    // which is exactly where a failed resolution should leave it; rethrowing
    // here would only produce an unhandled rejection after the response.
    console.error("ingest: resolution failed", rowId, error);
  }
}
