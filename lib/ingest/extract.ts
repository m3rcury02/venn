// SPEC §5 step 3: pull movie candidates out of arbitrary shared text, highest
// confidence first.
//
// Pure and I/O-free on purpose. Everything here is guesswork over text a user
// pasted from Instagram or YouTube, which is exactly the part worth being able
// to run against real samples without a network or a database -- see
// scripts/ingest-smoke.ts.
//
// Confidence is carried by ORDER and by `kind`, not by a separate score. A url
// names one film and nothing else, so the two id kinds are the high-confidence
// ones by construction; `query` always has to be resolved and checked before it
// can be trusted. A numeric confidence field would be a third encoding of the
// same fact.

export type Candidate =
  /** A provider id lifted straight out of a TMDB url. */
  | { kind: "external-id"; value: string }
  /** An IMDb id (tt…), which the provider resolves via findByImdbId. */
  | { kind: "imdb-id"; value: string }
  /** Free text to search for. Never auto-resolved without an exact title hit. */
  | { kind: "query"; value: string };

/**
 * More than this and we are searching the provider over noise. §5's flow only
 * ever needs the first candidate that produces anything.
 */
const MAX_CANDIDATES = 5;

/** Shorter than this is not a film title, it is a fragment. */
const MIN_QUERY_LENGTH = 2;

/** Longer than this is a sentence that happened to start with a capital. */
const MAX_QUERY_LENGTH = 60;

const URL_PATTERN = /https?:\/\/\S+/gi;

const TMDB_PATTERN = /themoviedb\.org\/movie\/(\d+)/gi;
const IMDB_PATTERN = /imdb\.com\/title\/(tt\d+)/gi;
const LETTERBOXD_PATTERN = /letterboxd\.com\/film\/([a-z0-9-]+)/gi;

/** `Inception (2010)` — the title is whatever precedes a parenthesised year. */
const TITLE_YEAR_PATTERN = /([^"“”(\n]{2,60}?)\s*\((?:19|20)\d{2}\)/g;

/** Straight and curly quotes both, since shared text carries either. */
const QUOTED_PATTERN = /"([^"\n]{2,60})"|[“]([^”\n]{2,60})[”]/g;

/**
 * A run of capitalised words, allowing the lowercase connectors real titles
 * contain ("The Lord of the Rings", "Everything Everywhere All at Once").
 *
 * The `\b` after the connector list is load-bearing: regex alternation is
 * ordered, so without it `a` matches inside "at" and the run stops dead --
 * "Everything Everywhere All at Once" truncates to "Everything Everywhere All a".
 */
const TITLE_CASE_PATTERN =
  /\b[A-Z][A-Za-z0-9'’&:.!?-]*(?:\s+(?:(?:of|the|and|a|an|in|on|at|to|for|from|with)\b|[A-Z][A-Za-z0-9'’&:.!?-]*))*/g;

/**
 * Words that start a share but are never a title on their own. A run that
 * reduces to nothing but these is dropped; one that merely starts with them has
 * them trimmed off the front.
 */
const BOILERPLATE = new Set([
  "a",
  "an",
  "and",
  "check",
  "film",
  "from",
  "full",
  "hd",
  "i",
  "in",
  "just",
  "movie",
  "movies",
  "official",
  "on",
  "out",
  "shared",
  "the",
  "this",
  "trailer",
  "via",
  "watch",
  "watching",
  "you",
  "your",
]);

/** Slug to something searchable: `the-dark-knight` -> `the dark knight`. */
function unslug(slug: string): string {
  return slug.replace(/-/g, " ").trim();
}

function clean(raw: string): string {
  // Trailing punctuation survives every pattern above -- "Inception." and
  // "Parasite:" would otherwise be distinct candidates from the real title.
  return raw.replace(/\s+/g, " ").replace(/^[\s'"“”:,.!?-]+|[\s'"“”:,.!?-]+$/g, "");
}

/**
 * Drops leading boilerplate words, then rejects what is left if it is empty,
 * too short, too long, or nothing but boilerplate. "Watch Inception" becomes
 * "Inception"; "Check this out" becomes nothing.
 */
function toQuery(raw: string): string | null {
  const words = clean(raw).split(" ").filter(Boolean);

  while (words.length > 0 && BOILERPLATE.has(words[0].toLowerCase())) {
    words.shift();
  }

  const value = words.join(" ");
  if (value.length < MIN_QUERY_LENGTH || value.length > MAX_QUERY_LENGTH) {
    return null;
  }
  if (words.every((word) => BOILERPLATE.has(word.toLowerCase()))) return null;

  return value;
}

/** All capture groups of every match, flattened and undefined-free. */
function captures(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].flatMap((match) =>
    match.slice(1).filter((group): group is string => group !== undefined),
  );
}

/**
 * Candidates in §5's confidence order: a provider url, then an IMDb url, then a
 * Letterboxd slug, then `Title (Year)`, then quoted strings, then Title Case
 * runs over what is left once urls are stripped.
 */
export function extractCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [
    ...captures(text, TMDB_PATTERN).map(
      (value): Candidate => ({ kind: "external-id", value }),
    ),
    ...captures(text, IMDB_PATTERN).map(
      (value): Candidate => ({ kind: "imdb-id", value }),
    ),
  ];

  // Letterboxd exports and urls carry no id of any kind -- only a slug -- so
  // this is a search, not a lookup, and it sits below the two id kinds.
  const queries = captures(text, LETTERBOXD_PATTERN).map(unslug);

  // Urls are stripped before the text patterns run: a url is a long
  // punctuation-dense run that would otherwise dominate every match below.
  const prose = text.replace(URL_PATTERN, " ");

  queries.push(
    ...captures(prose, TITLE_YEAR_PATTERN),
    ...captures(prose, QUOTED_PATTERN),
    // Handles and hashtags read as Title Case runs and are never film titles.
    ...(prose.replace(/[@#]\S+/g, " ").match(TITLE_CASE_PATTERN) ?? []),
  );

  for (const query of queries) {
    const value = toQuery(query);
    if (value) candidates.push({ kind: "query", value });
  }

  // Dedupe on kind+value, keeping the first (highest-confidence) occurrence.
  // The same title routinely appears as both a `Title (Year)` match and a Title
  // Case run within one share.
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.kind}:${candidate.value.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_CANDIDATES);
}
