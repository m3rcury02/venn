// Phase 1a verification. Not part of the app build.
//
//   pnpm smoke:tmdb
//
// Needs TMDB_API_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
// .env.local, and writes to whichever Supabase project that URL points at.
//
// Doubles as the TMDB half of SPEC §2's untested assumption: the per-film tag
// table below is the keyword-richness baseline any escape-hatch provider has to
// be measured against.

import { cacheMovie } from "@/lib/movies/cache";
import { PROVIDER_NAME, provider } from "@/lib/providers";
import { createServiceClient } from "@/lib/supabase/service";

type Film = {
  externalId: string;
  label: string;
  /**
   * Discovered at runtime to exercise date coercion, not tag richness. Obscure
   * by construction, so its tag counts are printed but never asserted on.
   */
  probe?: boolean;
};

// Chosen for spread: blockbuster, franchise, non-English, pre-1960, Indian,
// documentary, animation, and a recent tentpole.
const FILMS: Film[] = [
  { externalId: "27205", label: "Inception (2010)" },
  { externalId: "155", label: "The Dark Knight (2008)" },
  { externalId: "496243", label: "Parasite (2019, Korean)" },
  { externalId: "389", label: "12 Angry Men (1957)" },
  { externalId: "19404", label: "Dilwale Dulhania Le Jayenge (1995)" },
  { externalId: "515001", label: "Free Solo (2018, documentary)" },
  { externalId: "129", label: "Spirited Away (2001, animation)" },
  { externalId: "550", label: "Fight Club (1999)" },
  { externalId: "76600", label: "Avatar: The Way of Water (2022)" },
];

const REGION = "IN";
const INCEPTION_IMDB = "tt1375666";

// --------------------------------------------------------- instrumentation

let tmdbCalls = 0;
const realFetch: typeof fetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  // Supabase goes through the same global fetch, so count only the provider.
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

  section("1. search");
  const results = await provider.search("inception", REGION);
  check(results.length > 0, "search returns results", `${results.length} hits`);
  check(
    /^\d+$/.test(results[0]?.externalId ?? ""),
    "top hit carries a numeric TMDB id",
    results[0]?.externalId,
  );

  section("2. cacheMovie — cold");
  const dateless = await findDatelessFilm();
  const unreleased = await findUnreleasedFilm();
  const films = [...FILMS, ...dateless, ...unreleased];

  const ids = new Map<string, string>();
  for (const film of films) {
    const before = tmdbCalls;
    try {
      const id = await cacheMovie(film.externalId);
      ids.set(film.externalId, id);
      check(true, film.label, before === tmdbCalls ? "already cached" : `${tmdbCalls - before} TMDB calls`);
    } catch (error) {
      check(false, film.label, String(error));
    }
  }

  section("3. cacheMovie — warm");
  const callsBeforeWarm = tmdbCalls;
  let stable = true;
  for (const [externalId, id] of ids) {
    if ((await cacheMovie(externalId)) !== id) stable = false;
  }
  check(stable, "second pass returns identical internal ids");
  check(
    tmdbCalls === callsBeforeWarm,
    "second pass makes zero TMDB calls",
    `${tmdbCalls - callsBeforeWarm} calls`,
  );

  section("4. tag richness — SPEC §2 baseline");
  const table: Record<string, Record<string, number>> = {};
  for (const film of films) {
    const id = ids.get(film.externalId);
    if (!id) continue;

    const counts = await tagCounts(db, id);
    table[film.label] = counts;

    // Only the curated titles carry the baseline claim. Zero keywords on one of
    // those is a getTags parsing bug -- append_to_response nests movie keywords
    // under keywords.keywords, and the wrong shape yields silent zeros rather
    // than an error. Zero on a probe entry is just obscure data.
    if (!film.probe) {
      check(
        counts.keyword > 0,
        `${film.label} has keywords`,
        `${counts.keyword} keywords`,
      );
    }
  }
  console.table(table);

  section("5. findByImdbId");
  const found = await provider.findByImdbId(INCEPTION_IMDB);
  check(found?.externalId === "27205", "tt1375666 resolves to TMDB 27205", found?.externalId);

  // Self-contained on purpose: both sides are resolved here rather than read
  // back from step 2, so a network blip earlier cannot masquerade as a
  // two-lookup-paths mismatch.
  const viaImdb = found ? await cacheMovie(found.externalId) : null;
  const inceptionId = await cacheMovie("27205");
  check(
    viaImdb === inceptionId,
    "and lands on the same internal id — one movie, two lookup paths",
  );

  section("6. getExternalIds");
  const externalIds = await provider.getExternalIds("27205");
  check(
    externalIds.imdbId === INCEPTION_IMDB,
    "TMDB 27205 carries IMDb tt1375666",
    externalIds.imdbId ?? "null",
  );

  section("7. getWatchProviders");
  const watch = await provider.getWatchProviders("27205", REGION);
  check(
    watch.providers.length > 0,
    `returns providers for ${REGION}`,
    `${watch.providers.length} entries`,
  );
  // Without this the UI cannot link out, and displaying the data at all obliges
  // us to attribute JustWatch — see docs/DECISIONS.md.
  check(
    typeof watch.link === "string" && watch.link.length > 0,
    "carries the per-region watch link",
    watch.link ?? "null",
  );

  section("8. getImageUrl");
  const url = provider.getImageUrl("/abc.jpg", "w342");
  check(
    url === "https://image.tmdb.org/t/p/w342/abc.jpg",
    "builds a CDN url without downloading anything",
    url,
  );

  section("9. rows actually landed");
  const cachedIds = [...ids.values()];

  const { count: movieCount, error: movieError } = await db
    .from("movies")
    .select("id", { count: "exact", head: true })
    .in("id", cachedIds);
  if (movieError) throw movieError;
  check(movieCount === cachedIds.length, "every cached id exists in movies", `${movieCount}/${cachedIds.length}`);

  const { data: mapped, error: mapError } = await db
    .from("movie_external_ids")
    .select("movie_id")
    .eq("provider", PROVIDER_NAME)
    .in("movie_id", cachedIds);
  if (mapError) throw mapError;
  check(mapped.length === cachedIds.length, `every one is mapped under provider='${PROVIDER_NAME}'`);

  const inception = await tagCounts(db, inceptionId);
  check(
    inception.genre > 0 && inception.keyword > 0 && inception.person > 0,
    "movie_tags carries all three tag types",
    JSON.stringify(inception),
  );

  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}  ·  ${tmdbCalls} TMDB calls total`);
  if (failures > 0) process.exitCode = 1;
}

// ------------------------------------------------------------------ helpers

type Db = ReturnType<typeof createServiceClient>;

async function tagCounts(db: Db, movieId: string) {
  const { data, error } = await db
    .from("movie_tags")
    .select("tags(tag_type)")
    .eq("movie_id", movieId);
  if (error) throw error;

  const counts = { genre: 0, keyword: 0, person: 0 };
  for (const row of data) {
    // The embed comes back as an object for a many-to-one, but the client is
    // untyped here, so accept either shape.
    const tag = Array.isArray(row.tags) ? row.tags[0] : row.tags;
    const type = tag?.tag_type as keyof typeof counts | undefined;
    if (type) counts[type]++;
  }
  return counts;
}

/**
 * TMDB returns release_date as "" rather than null for films with no known
 * date, which the `date` column rejects. Find a live one so the coercion is
 * exercised against real data rather than assumed.
 */
async function findDatelessFilm() {
  const candidates = await provider.search("untitled", REGION);
  const hit = candidates.find((movie) => movie.year === null);
  if (!hit) {
    console.log("      (no dateless film in the sample — empty release_date not exercised)");
    return [];
  }
  return [
    { externalId: hit.externalId, label: `${hit.title} (no release date)`, probe: true },
  ];
}

async function findUnreleasedFilm() {
  const upcoming = await provider.upcoming(REGION);
  const hit = upcoming.at(-1);
  if (!hit) {
    console.log("      (upcoming returned nothing — unreleased film not exercised)");
    return [];
  }
  return [
    { externalId: hit.externalId, label: `${hit.title} (unreleased)`, probe: true },
  ];
}

// Not top-level await: package.json has no "type": "module", so this file is
// transpiled to CJS.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
