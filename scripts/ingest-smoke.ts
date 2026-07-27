// Verification for lib/ingest/extract.ts (SPEC §5 step 3).
//
// Same shape as scripts/tmdb-smoke.ts, and run the same way -- `tsx` under a
// pnpm script. No test runner: adding one is a new dependency, and CLAUDE.md
// says ask first.
//
// extract.ts is pure, so this needs no network, no database and no env. What it
// pins is the part that is genuinely guesswork: which of §5's six patterns wins
// on text a person actually shared.
//
//   pnpm smoke:ingest

import { extractCandidates, type Candidate } from "../lib/ingest/extract";

type Case = {
  name: string;
  text: string;
  /** The first candidate, which is the only one §5's flow acts on first. */
  expect: Candidate | null;
};

const CASES: Case[] = [
  {
    name: "TMDB movie url",
    text: "https://www.themoviedb.org/movie/27205-inception",
    expect: { kind: "external-id", value: "movie-27205" },
  },
  {
    name: "TMDB tv url",
    text: "https://www.themoviedb.org/tv/1396-breaking-bad",
    expect: { kind: "external-id", value: "tv-1396" },
  },
  {
    name: "IMDb url",
    text: "watch this https://www.imdb.com/title/tt0816692/ tonight",
    expect: { kind: "imdb-id", value: "tt0816692" },
  },
  {
    name: "Letterboxd url",
    text: "https://letterboxd.com/film/the-dark-knight/",
    expect: { kind: "query", value: "dark knight" },
  },
  {
    name: "Title (Year)",
    text: "Parasite (2019) is on my list",
    expect: { kind: "query", value: "Parasite" },
  },
  {
    name: "quoted title",
    text: 'someone said "Spirited Away" is the best one',
    expect: { kind: "query", value: "Spirited Away" },
  },
  {
    name: "bare Title Case run",
    text: "Everything Everywhere All at Once",
    expect: { kind: "query", value: "Everything Everywhere All at Once" },
  },
  {
    name: "boilerplate is trimmed off the front",
    text: "watch Fight Club",
    expect: { kind: "query", value: "Fight Club" },
  },
  {
    name: "a url outranks prose in the same share",
    text: "You have to see this — https://www.themoviedb.org/movie/496243",
    expect: { kind: "external-id", value: "movie-496243" },
  },
  {
    name: "instagram caption with no film url",
    // The common case, and the one §5 designed the Inbox for: the url names the
    // post, not the film, so this has to reach a human rather than be guessed.
    text: "this scene 😭😭 #cinema @a24 https://www.instagram.com/p/C8xY2/",
    expect: null,
  },
  {
    name: "pure boilerplate resolves to nothing",
    text: "check this out",
    expect: null,
  },
];

function describe(candidate: Candidate | null): string {
  return candidate ? `${candidate.kind}:${candidate.value}` : "(none)";
}

function main() {
  let failed = 0;

  for (const testCase of CASES) {
    const candidates = extractCandidates(testCase.text);
    const first = candidates[0] ?? null;

    const ok =
      first?.kind === testCase.expect?.kind &&
      first?.value === testCase.expect?.value;

    if (!ok) failed++;

    console.log(`${ok ? "ok  " : "FAIL"} ${testCase.name}`);
    console.log(`       text     ${JSON.stringify(testCase.text)}`);
    console.log(`       want     ${describe(testCase.expect)}`);
    console.log(`       got      ${describe(first)}`);
    if (candidates.length > 1) {
      console.log(`       then     ${candidates.slice(1).map(describe).join(" | ")}`);
    }
  }

  console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
  if (failed > 0) process.exitCode = 1;
}

main();
