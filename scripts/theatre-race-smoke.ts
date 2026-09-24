// Concurrent theatre-pool refreshes against a LOCAL Supabase stack, with TMDB
// stubbed. lib/movies/theatre.ts used to refresh a region with
// delete-then-insert. When two renders found the region stale at the same
// moment, their writes interleaved: one hit the primary key, and readers
// between the delete and the insert got an empty pool. Measured before the
// fix: 4 of 8 simultaneous renders came back with zero titles. This pins the
// upsert-then-prune replacement.
//
// Needs no TMDB key or network: api.themoviedb.org is answered in-process,
// the same way scripts/refresh-smoke.ts does it. The region is "ZZ", a
// user-assigned ISO code no real profile carries, and it is cleaned up after.
//
//   supabase start
//   pnpm smoke:theatre-race

import { theatreCandidates } from "@/lib/movies/theatre";
import { createServiceClient } from "@/lib/supabase/service";

const REGION = "ZZ";
const CONCURRENCY = 8;
// Out of range of real TMDB ids, and distinct from refresh-smoke's 9000000xx.
const IDS = [910000001, 910000002, 910000003];
const SOON = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// What now_playing/upcoming currently return. Section 2 shrinks it to prove
// a film that leaves cinemas is pruned even when refreshes overlap.
let listed = IDS;

const realFetch: typeof fetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "api.themoviedb.org") return realFetch(input, init);

  // Jitter, so the concurrent refreshes really do interleave their writes
  // instead of finishing in the order they started.
  await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 60));

  if (/\/movie\/(now_playing|upcoming)$/.test(url.pathname)) {
    const results = listed.map((id) => ({
      id,
      title: `Race ${id}`,
      release_date: SOON,
      poster_path: null,
    }));
    return new Response(JSON.stringify({ page: 1, total_pages: 1, results }), { status: 200 });
  }

  const id = Number(url.pathname.match(/^\/3\/movie\/(\d+)$/)?.[1]);
  if (!IDS.includes(id)) return new Response("{}", { status: 404, statusText: "Not Found" });

  return new Response(
    JSON.stringify({
      id,
      title: `Race ${id}`,
      original_title: `Race ${id}`,
      poster_path: null,
      backdrop_path: null,
      overview: "A title that only exists in scripts/theatre-race-smoke.ts.",
      vote_average: 5,
      release_date: SOON,
      runtime: 90,
      genres: [],
      keywords: { keywords: [] },
      credits: { cast: [], crew: [] },
      videos: { results: [] },
    }),
    { status: 200 },
  );
};

let failures = 0;

function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? " ok " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

function section(title: string) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

const db = createServiceClient();

async function regionMovieIds(): Promise<string[]> {
  const { data, error } = await db.from("movie_releases").select("movie_id").eq("region", REGION);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.movie_id as string))];
}

async function cleanup() {
  const { error } = await db.from("movie_releases").delete().eq("region", REGION);
  if (error) throw error;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error(`Refusing to run against ${url || "(unset)"}: local stack only.`);
  }

  await cleanup();

  section(`1. ${CONCURRENCY} cold refreshes of one region at once`);
  const cold = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => theatreCandidates(REGION)),
  );
  const sizes = cold.map((candidates) => new Set(candidates.map((c) => c.movieId)).size);
  check(
    sizes.every((size) => size === IDS.length),
    "every concurrent render gets the full pool, none an empty one",
    sizes.join(","),
  );
  check(
    (await regionMovieIds()).length === IDS.length,
    "the region holds exactly the listed films afterwards",
  );

  section("2. a film leaves cinemas while refreshes overlap");
  const { error: staleError } = await db
    .from("movie_releases")
    .update({ fetched_at: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() })
    .eq("region", REGION);
  if (staleError) throw staleError;

  listed = IDS.slice(0, 2);
  const warm = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => theatreCandidates(REGION)),
  );
  // Positive control for the prune check below: the refresh must still
  // return real titles, or "the dropped film is gone" passes because
  // everything is gone.
  check(
    warm.every((candidates) => candidates.length > 0),
    "control: every render still returns candidates",
  );
  check(
    (await regionMovieIds()).length === listed.length,
    "the film no longer listed is pruned, not left behind",
  );

  await cleanup();

  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}`);
  if (failures > 0) process.exitCode = 1;
}

// Not top-level await: package.json has no "type": "module", so this file is
// transpiled to CJS.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
