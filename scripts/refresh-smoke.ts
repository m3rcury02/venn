// Verification for lib/movies/refresh.ts: TMDB's 6-month cache limit.
// Not part of the app build.
//
//   pnpm smoke:refresh
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local,
// pointing at a LOCAL stack: the script refuses anything else, because it
// backdates and deletes catalog rows. It needs no TMDB key. Real TMDB data
// can't be made to change on demand, and what this pins is how the cache reacts
// when a title's data *has* changed. So fetch is stubbed with a fake TMDB whose
// answers the script controls. scripts/tmdb-smoke.ts already covers the real
// API's response shapes.

import { cacheMovie } from "@/lib/movies/cache";
import { refreshStaleCatalog } from "@/lib/movies/refresh";
import { createServiceClient } from "@/lib/supabase/service";

const LIVE_ID = 900000001;
const GONE_ID = 900000404;
const DAY_MS = 24 * 60 * 60 * 1000;

// ----------------------------------------------------------------- fake TMDB

type Version = { title: string; keyword: string; trailer: string };
let version: Version = { title: "Smoke Refresh v1", keyword: "smoke-kw-one", trailer: "trailerOne" };

let tmdbCalls = 0;
const realFetch: typeof fetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "api.themoviedb.org") return realFetch(input, init);

  tmdbCalls++;
  const id = Number(url.pathname.match(/^\/3\/movie\/(\d+)$/)?.[1]);
  if (id !== LIVE_ID) {
    return new Response("{}", { status: 404, statusText: "Not Found" });
  }

  // getMovie asks for videos and getTags for keywords and credits, both on
  // /movie/{id}. One object carrying all of it answers either call.
  const detail = {
    id: LIVE_ID,
    title: version.title,
    original_title: version.title,
    poster_path: "/smoke.jpg",
    backdrop_path: null,
    overview: "A title that only exists in scripts/refresh-smoke.ts.",
    vote_average: 7.1,
    release_date: "2020-01-01",
    runtime: 101,
    genres: [{ name: "smoke-genre" }],
    keywords: { keywords: [{ name: version.keyword }] },
    credits: { cast: [{ name: "Smoke Actor" }], crew: [] },
    videos: {
      results: [{ key: version.trailer, site: "YouTube", type: "Trailer", official: true }],
    },
  };
  return new Response(JSON.stringify(detail), { status: 200 });
};

// ------------------------------------------------------------------- harness

let failures = 0;

function check(ok: boolean, label: string, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? " ok " : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
}

function section(title: string) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

const db = createServiceClient();

async function keywordsOf(movieId: string): Promise<string[]> {
  const { data, error } = await db
    .from("movie_tags")
    .select("tags!inner(tag_type, tag_value)")
    .eq("movie_id", movieId)
    .eq("tags.tag_type", "keyword");
  if (error) throw error;
  return ((data ?? []) as unknown as { tags: { tag_value: string } }[]).map(
    (r) => r.tags.tag_value,
  );
}

async function backdate(table: "movies" | "tags", column: string, value: string, days: number) {
  const { error } = await db
    .from(table)
    .update({ fetched_at: new Date(Date.now() - days * DAY_MS).toISOString() })
    .eq(column, value);
  if (error) throw error;
}

async function cleanup() {
  const { data } = await db
    .from("movie_external_ids")
    .select("movie_id")
    .in("external_id", [`movie-${LIVE_ID}`, `movie-${GONE_ID}`]);
  const ids = (data ?? []).map((r) => r.movie_id);
  if (ids.length > 0) await db.from("movies").delete().in("id", ids);
  await db
    .from("tags")
    .delete()
    .in("tag_value", ["smoke-kw-one", "smoke-kw-two", "smoke-genre", "Smoke Actor"]);
}

// ---------------------------------------------------------------------- main

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
    throw new Error(`Refusing to run against ${url || "(unset)"}: local stack only.`);
  }

  await cleanup();

  section("1. seed");
  const movieId = await cacheMovie(`movie-${LIVE_ID}`);
  check(tmdbCalls === 2, "cacheMovie makes the usual two TMDB calls", `${tmdbCalls}`);

  // A title TMDB has since removed. It can't be cached through cacheMovie (the
  // fake answers 404), so it goes in directly, the way it would have been
  // cached back when TMDB still had it.
  const { data: goneRow, error: goneError } = await db
    .from("movies")
    .insert({ title: "Smoke Removed From TMDB" })
    .select("id")
    .single();
  if (goneError) throw goneError;
  const goneId = goneRow.id as string;
  const { error: mapError } = await db
    .from("movie_external_ids")
    .insert({ movie_id: goneId, provider: "tmdb", external_id: `movie-${GONE_ID}` });
  if (mapError) throw mapError;

  section("2. nothing is stale yet");
  tmdbCalls = 0;
  const fresh = await refreshStaleCatalog();
  check(tmdbCalls === 0, "a fresh catalog costs no TMDB calls", `${tmdbCalls}`);
  check(fresh.refreshed === 0 && fresh.gone.length === 0, "nothing refreshed, nothing gone");

  section("3. past 150 days, TMDB's data has changed");
  await backdate("movies", "id", movieId, 160);
  await backdate("movies", "id", goneId, 170);
  version = { title: "Smoke Refresh v2", keyword: "smoke-kw-two", trailer: "trailerTwo" };

  tmdbCalls = 0;
  const report = await refreshStaleCatalog();
  console.log(`      report: ${JSON.stringify(report)}`);

  check(report.refreshed >= 1, "the live title is refreshed");
  check(report.gone.includes(`movie-${GONE_ID}`), "the removed title is reported as gone");

  const { data: after, error: afterError } = await db
    .from("movies")
    .select("id, title, trailer_key, fetched_at")
    .eq("id", movieId)
    .single();
  if (afterError) throw afterError;

  check(after.title === "Smoke Refresh v2", "title rewritten in place", after.title);
  check(after.trailer_key === "trailerTwo", "trailer key rewritten", after.trailer_key ?? "null");
  check(
    Date.now() - new Date(after.fetched_at).getTime() < 60_000,
    "fetched_at stamped now, so the 6-month clock restarts",
  );

  const keywords = await keywordsOf(movieId);
  check(
    keywords.length === 1 && keywords[0] === "smoke-kw-two",
    "keywords replaced: the new one added, the dropped one removed",
    JSON.stringify(keywords),
  );

  const { data: goneAfter } = await db
    .from("movies")
    .select("id")
    .eq("id", goneId)
    .maybeSingle();
  check(goneAfter !== null, "the removed title's row is kept (deleting it would cascade into lists)");

  section("4. the dropped keyword is pruned once it is a day old");
  const { data: droppedTag } = await db
    .from("tags")
    .select("id")
    .eq("tag_value", "smoke-kw-one")
    .maybeSingle();
  check(droppedTag !== null, "an orphan tag younger than a day survives this run");

  await backdate("tags", "tag_value", "smoke-kw-one", 2);
  const pruned = await refreshStaleCatalog();
  const { data: droppedAfter } = await db
    .from("tags")
    .select("id")
    .eq("tag_value", "smoke-kw-one")
    .maybeSingle();
  check(droppedAfter === null, "and is deleted once it is older than a day");
  check(pruned.pruned.orphan_tags >= 1, "prune_catalog counts it", JSON.stringify(pruned.pruned));

  section("5. a refreshed title is left alone");
  tmdbCalls = 0;
  const again = await refreshStaleCatalog();
  // Only the removed title is still stale, and it costs two calls (getMovie
  // and getTags run together) every run until someone deals with it.
  check(
    again.refreshed === 0 && tmdbCalls === 2,
    "the next run only retries the removed title",
    `refreshed=${again.refreshed}, calls=${tmdbCalls}`,
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
