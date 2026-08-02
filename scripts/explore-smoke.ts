// Explore (post-phase-9) verification. Not part of the app build.
//
//   pnpm smoke:explore
//
// Needs TMDB_API_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
// and SUPABASE_SERVICE_ROLE_KEY in .env.local, and writes to whichever Supabase
// project that URL points at. Run after a fresh `supabase db reset` -- this
// script asserts on cold vs warm TMDB call counts, and a warm catalog from
// earlier runs would make those counts meaningless (same caveat as
// scripts/theatre-smoke.ts:7-9).

import { createClient } from "@supabase/supabase-js";
import { exploreFeed } from "@/lib/movies/explore";
import { createServiceClient } from "@/lib/supabase/service";

const REGION = "IN";

// The exclusion test needs a user_movie_status row for a *real* auth user --
// user_id has a foreign key to profiles, which references auth.users (phase
// 0). createUser via the service-role admin API fires the handle_new_user
// trigger that provisions the profile row.
const EMAIL = `explore-smoke-${Date.now()}@example.com`;
const PASSWORD = "explore-smoke-password";

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
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (!process.env[key]) throw new Error(`${key} is not set — see .env.example`);
  }

  const db = createServiceClient();

  const { data: user, error: userError } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError) throw userError;
  if (!user.user.id) throw new Error("admin.createUser returned no user id");
  const userId = user.user.id;

  // The exclusion test's vote insert goes through the user's *own* client, not
  // the service client: user_movie_status writes are RLS-only by design (the
  // grants migration scoped service_role to SELECT), so we present the user's
  // access token the way the app's cookie client does in a browser.
  const { data: signIn, error: signInError } = await db.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (signInError) throw signInError;
  if (!signIn.session) throw new Error("no session after sign-in");
  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: { Authorization: `Bearer ${signIn.session.access_token}` },
      },
    },
  );

  section("1. cold call");
  const coldCalls = tmdbCalls;
  const cold = await exploreFeed(userId, REGION, 1);
  check(cold.length > 0, "cold call returns cards", `${cold.length} cards`);
  check(tmdbCalls > coldCalls, "hit TMDB on a cold pool", `${tmdbCalls - coldCalls} calls`);
  check(
    cold.every((card) => card.movieId != null),
    "every card carries an internal movieId",
    `${cold.filter((card) => card.movieId == null).length} missing`,
  );

  section("2. warm call");
  const warmCallsBefore = tmdbCalls;
  const warm = await exploreFeed(userId, REGION, 1);
  // "Fewer" is against the cold call's own spend (a warm pool makes zero
  // calls, and 0 < 0 would fail a bare comparison against the counter).
  const warmNewCalls = tmdbCalls - warmCallsBefore;
  const coldNewCalls = warmCallsBefore - coldCalls;
  check(
    warmNewCalls < coldNewCalls,
    "second call makes fewer TMDB calls",
    `${warmNewCalls} vs ${coldNewCalls}`,
  );
  check(warm.length > 0, "warm call still returns cards", `${warm.length} cards`);

  section("3. backfill marks its work");
  // A fresh catalog stamps trailer_fetched_at on every insert, so a null key
  // must always be accompanied by a timestamp: the backfill only ever queries
  // rows it has not looked at, and never re-queries trailer-less titles.
  const trailerLess = warm.filter((card) => card.trailerKey === null);
  if (trailerLess.length > 0) {
    const { data: rows, error: rowsError } = await db
      .from("movies")
      .select("id, trailer_key, trailer_fetched_at")
      .in(
        "id",
        trailerLess.map((card) => card.movieId),
      );
    if (rowsError) throw rowsError;
    const unstamped = (rows ?? []).filter(
      (row) => row.trailer_key === null && row.trailer_fetched_at === null,
    );
    check(
      unstamped.length === 0,
      "trailer-less cards were still marked as looked-at",
      `${unstamped.length} unmarked`,
    );
  } else {
    check(true, "no trailer-less cards on this page — nothing to check");
  }

  section("4. voted titles are excluded");
  // Positive control before the negative assertion: an empty feed would make
  // "the first card is absent" pass for the wrong reason. Same "no negative
  // without a control" rule theatre-smoke.ts:115-120 applies.
  const control = await exploreFeed(userId, REGION, 1);
  check(control.length > 0, "control: the feed still returns cards", `${control.length} cards`);
  if (control.length === 0) return;

  const firstCard = control[0];
  const { error: voteError } = await userClient.from("user_movie_status").insert({
    user_id: userId,
    movie_id: firstCard.movieId,
    watched: false,
    hype: "hyped",
    rating: null,
    updated_at: new Date().toISOString(),
  });
  if (voteError) throw voteError;

  const after = await exploreFeed(userId, REGION, 1);
  check(
    !after.some((card) => card.movieId === firstCard.movieId),
    "a hyped title is absent from the next call",
    `first card: ${firstCard.title}`,
  );
  // Second control: the absence above must come from the exclusion, not from
  // the feed collapsing to zero.
  check(after.length > 0, "control: the feed is still non-empty", `${after.length} cards`);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}  ·  ${tmdbCalls} TMDB calls total`);
  if (failures > 0) process.exitCode = 1;
}

// Not top-level await: package.json has no "type": "module", so this file is
// transpiled to CJS.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
