// Phase 9 verification. Not part of the app build.
//
//   pnpm smoke:theatre
//
// Needs TMDB_API_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
// .env.local, and writes to whichever Supabase project that URL points at.
// Run after a fresh `supabase db reset` -- this script asserts on the exact
// contents of movie_releases for one region, and a warm catalog from earlier
// runs would make the truncation/cap reporting below meaningless.

import { theatreCandidates } from "@/lib/movies/theatre";
import { cacheMovie } from "@/lib/movies/cache";
import { createServiceClient } from "@/lib/supabase/service";

const REGION = "IN";
const TTL_HOURS = 12;
const UPCOMING_WEEKS = 4;

// --------------------------------------------------------- instrumentation

let tmdbCalls = 0;
const realFetch: typeof fetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://api.themoviedb.org")) tmdbCalls++;
  return realFetch(input, init);
};

let failures = 0;

function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? " ok " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

function section(title: string) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

// ------------------------------------------------------------------- steps

async function main() {
  for (const key of [
    "TMDB_API_KEY",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (!process.env[key]) throw new Error(`${key} is not set — see .env.example`);
  }

  const db = createServiceClient();

  section("1. cold refresh");
  const coldCalls = tmdbCalls;
  const cold = await theatreCandidates(REGION);
  check(cold.length > 0, "returns candidates", `${cold.length} candidates`);
  check(tmdbCalls > coldCalls, "hit TMDB on a cold region", `${tmdbCalls - coldCalls} calls`);

  const { data: rows, error: rowsError } = await db
    .from("movie_releases")
    .select("movie_id, release_date, release_type, fetched_at")
    .eq("region", REGION);
  if (rowsError) throw rowsError;
  check(
    (rows?.length ?? 0) === cold.length,
    "movie_releases holds exactly what was returned",
    `${rows?.length ?? 0} rows / ${cold.length} candidates`,
  );

  const truncated = (rows ?? []).some(
    (r) => Date.now() - new Date(r.fetched_at).getTime() > 60_000,
  );
  console.log(
    truncated
      ? "      (this refresh was capped by MAX_NEW_TITLES — rows stamped stale on arrival, by design)"
      : "      (every wanted title resolved within the cap)",
  );

  section("2. warm refresh — inside the TTL");
  const warmCallsBefore = tmdbCalls;
  const warm = await theatreCandidates(REGION);
  check(tmdbCalls === warmCallsBefore, "makes zero TMDB calls", `${tmdbCalls - warmCallsBefore} calls`);
  check(
    warm.length === cold.length &&
      new Set(warm.map((c) => c.movieId)).size === new Set(cold.map((c) => c.movieId)).size,
    "returns the same candidate set",
  );

  section("3. delete-on-refresh — a film that left the pool");
  // Force the whole region stale, then plant a row for a movie that is
  // definitely not in nowPlaying/upcoming right now (a 2010 release). If the
  // refresh only upserted the current set and never deleted, this row would
  // survive forever and the pool would grow monotonically -- the one silent
  // bug this cache design has to avoid.
  const staleTimestamp = new Date(Date.now() - (TTL_HOURS + 1) * 60 * 60 * 1000).toISOString();
  const { error: staleError } = await db
    .from("movie_releases")
    .update({ fetched_at: staleTimestamp })
    .eq("region", REGION);
  if (staleError) throw staleError;

  const phantomId = await cacheMovie("movie-27205"); // Inception (2010)
  const { error: phantomError } = await db.from("movie_releases").insert({
    movie_id: phantomId,
    region: REGION,
    release_date: null,
    release_type: "theatrical",
    fetched_at: staleTimestamp,
  });
  if (phantomError) throw phantomError;

  const refreshed = await theatreCandidates(REGION);

  // Positive control: without this, an empty refresh (e.g. a bad TMDB
  // response) would also make the phantom-count check below pass — the
  // phantom would be gone because everything is gone, not because
  // delete-on-refresh worked. Same "no negative without a control" rule the
  // pgTAP suite enforces.
  check(refreshed.length > 0, "control: the refresh still returns real candidates");

  const { count: phantomCount, error: phantomCheckError } = await db
    .from("movie_releases")
    .select("movie_id", { count: "exact", head: true })
    .eq("region", REGION)
    .eq("movie_id", phantomId)
    .eq("release_type", "theatrical");
  if (phantomCheckError) throw phantomCheckError;
  check(phantomCount === 0, "a film no longer showing is deleted, not left behind");

  section("4. upcoming window");
  const { data: upcomingRows, error: upcomingError } = await db
    .from("movie_releases")
    .select("release_date")
    .eq("region", REGION)
    .eq("release_type", "upcoming");
  if (upcomingError) throw upcomingError;

  const windowEnd = Date.now() + UPCOMING_WEEKS * 7 * 24 * 60 * 60 * 1000;
  const outOfWindow = (upcomingRows ?? []).filter(
    (r) => r.release_date && new Date(r.release_date).getTime() > windowEnd,
  );
  check(
    outOfWindow.length === 0,
    `all ${upcomingRows?.length ?? 0} upcoming rows fall inside the ${UPCOMING_WEEKS}-week window`,
    outOfWindow.length > 0 ? JSON.stringify(outOfWindow) : "",
  );

  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}  ·  ${tmdbCalls} TMDB calls total`);
  if (failures > 0) process.exitCode = 1;
}

// Not top-level await: package.json has no "type": "module", so this file is
// transpiled to CJS.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
