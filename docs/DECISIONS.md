# Decisions

**Current phase: 1a**

Append after every phase: what changed, and why.

---

## Phase 0 — schema, RLS, magic-link auth

Migration: `supabase/migrations/20260726002633_phase0_core.sql`.

### Which of §3 got built

Eight tables: `profiles`, `movies`, `movie_external_ids`, `tags`, `movie_tags`,
`lists`, `list_items`, `user_movie_status` — the tables whose ownership is
single-user today, so their policies can be written correctly now.

Everything else in §3 is deferred to the phase that first consumes it: groups →
3, `hype_history`/`user_tag_weights` → 4, ingest → 5, `imports` → 8,
`movie_releases` → 9, follows/blocks/`list_hidden_from` → 10, movie nights,
reports and `notification_prefs` → 11.

§3's wider read predicate (public lists, group-owned lists, followed users) is
deliberately absent. §9 names phase 3's deliverable "multi-user RLS" and phase
10's "follows, visibility toggles, blocks" — those phases exist to widen these
policies. Building them now would leave both phases with no schema work.

### Departures from §3, and when they resolve

- **`profiles.username` is nullable.** Onboarding (§7 screen 2) is phase 8, so
  nothing can populate it yet. A `username_format` check applies only when
  non-null.
- **`lists.owner_user_id` is NOT NULL and there is no `owner_group_id`.** §3
  specifies two nullable owner columns under
  `num_nonnulls(owner_user_id, owner_group_id) = 1`. Phase 3 makes the column
  nullable, adds `owner_group_id` with its FK, and swaps in that check — that
  ALTER *is* "group lists." Carrying a column now that can never be non-null is
  dead weight. A partial unique index enforces one default list per user.

### Grants are a second gate, independent of RLS

The migration revokes all privileges on its eight tables from `anon`,
`authenticated` and `service_role`, then grants back exactly what each policy
set needs. `anon` gets nothing, so signed-out access fails a layer earlier than
RLS.

The `REVOKE` is load-bearing because **the two environments disagree without
it**, in opposite directions:

- A **fresh local stack** grants no DML on new tables at all. Every policy is
  unreachable and the API answers `permission denied for table ...`. This is how
  the gap was found — the first RLS test run failed on `profiles` before a
  single policy was evaluated.
- A **hosted project** carries `ALTER DEFAULT PRIVILEGES` granting all DML to
  `anon`, `authenticated` and `service_role`, so new tables arrive fully
  reachable. RLS still denied everything (`anon` has no policies), but the
  second gate was absent and the suite's `anon` assertions would not have held
  there.

Revoking first makes the end state identical in both, which is what lets one
test suite be valid against either. Verified: local and remote now produce the
same fingerprint over all columns, policies and grants
(`222eaf7bc93aad5b81f43bba547938d1`, 97 objects).

The catalog tables (`movies`, `movie_external_ids`, `tags`, `movie_tags`) end up
SELECT-only for `authenticated` and writable by `service_role`. Having *no*
write policies is the enforcement mechanism for CLAUDE.md's "provider calls are
server-side only": the write-through cache is unwritable from the browser.

### `handle_new_user`

`SECURITY DEFINER` trigger on `auth.users` inserting the profile and the default
list. Two hardenings beyond the commonly published snippet: `set search_path =
''` (so every name is schema-qualified), and a `REVOKE EXECUTE ... FROM public,
anon, authenticated`, because Postgres grants EXECUTE to PUBLIC by default,
which would otherwise make it a callable endpoint for `anon`.

### Auth

Magic link via `signInWithOtp`, verified server-side at `/auth/confirm` with
`verifyOtp({ type, token_hash })` — the token-hash flow, not
`exchangeCodeForSession` (that is the OAuth code flow). Both the `magic_link`
and `confirmation` email templates point at `/auth/confirm`, because
`signInWithOtp` defaults to `shouldCreateUser: true` and the first sign-in for
an unknown address sends the confirmation template.

Session refresh lives in `proxy.ts`, **not** `middleware.ts` — Next 16 renamed
the convention (export `proxy`, nodejs runtime only). Auth checks use
`getClaims()`, which verifies the JWT signature; `getSession()` is not
trustworthy in server code because cookies are spoofable.

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are
intentionally `NEXT_PUBLIC_`. The publishable key is designed for browser
exposure and RLS is what gates it. CLAUDE.md's "never `NEXT_PUBLIC_`" rule is
about the TMDB provider key (phase 1a). §11 lists `SUPABASE_ANON_KEY`; that
naming predates Supabase's publishable-key rename.

### Tests

`supabase/tests/rls.test.sql`, 20 pgTAP assertions via `supabase test db`.

Six are **positive controls** and they are load-bearing. Every negative here has
the shape "A cannot see B's row", and if `request.jwt.claims` were unset then
`auth.uid()` would be NULL and all of them would pass for the wrong reason — A
sees nothing, so A sees nothing of B's. Verified by deliberately blanking the
claims: exactly the 6 controls failed and every negative still passed. Do not
add negatives to this file without a control that covers the same table.

The same reasoning applies within a table. "A cannot read list items in B's
list" would still pass if `list_items_select_via_list` were
`using (added_by = auth.uid())` rather than the parent-list join it actually is,
so a companion assertion inserts into B's list directly and expects `42501`.
That one pins the join, which is the predicate phase 3 rewrites.

One assertion is labelled `constraint:` — it covers the composite primary key,
not access control. Nineteen are about access.

§11's own examples ("a non-member must not read a group's list") need `groups`
and belong to phase 3. The suite grows per phase.

### How this reached the remote project

The CLI has no stored session here (`supabase link` needs an interactive login
plus the database password), so the migration was applied to
`vfkkpflenfpfrrygxmto` through the authenticated Supabase MCP instead. Same SQL,
same file in the repo.

Two consequences worth knowing:

- `apply_migration` stamps its own version. The local file was renamed from
  `20260726000518` to `20260726002633` so the two agree — without that a later
  `supabase db push` would treat the migration as unapplied and try to re-run
  it. If you ever wonder why the filename doesn't match what
  `supabase migration new` produced, this is why.
- The remote `supabase_migrations.schema_migrations` row stores the SQL text as
  it was first applied, which predates the `REVOKE` block; the revoke/grant was
  then applied separately. The *schema* is identical either way (fingerprint
  above), and `db push` compares versions rather than contents, so this is
  cosmetic. A `supabase db pull` after linking would re-baseline it.

### Open, for later

- `AGENTS.md` / `CLAUDE.md` are byte-identical and both still list pgvector in
  the Stack line. SPEC §1 and §10 reject pgvector; the extension was not
  enabled. The stale line should be corrected so no agent acts on it.
- Supabase's baseline default privileges hand `anon` broad rights on new tables
  (TRUNCATE locally, full DML on hosted). The `REVOKE` above fixes it for these
  eight tables, but **every future migration must revoke too** — it is not a
  one-time cleanup. Worth a lint before public launch.

---

## Phase 1a — provider interface, TMDB adapter, write-through cache

**No schema change.** Phase 0's catalog tables already carry every column TMDB
returns, and `service_role` already has the DML grants plus
`usage, select on sequence tags_id_seq`. This phase is the first thing that
writes them.

> **Verification status.** `pnpm smoke:tmdb` passes against the live TMDB API
> and the local Supabase stack — 11 films cached, second pass makes zero TMDB
> calls, 0 orphaned `movies` rows, 263 tags shared across 281 `movie_tags`
> links. The two-calls-per-cache-miss claim is measured, not assumed.
> Note `pnpm build` covers none of these files: nothing in `app/` imports them
> yet, so the bundler never sees them. `tsc` does.

```
lib/providers/types.ts      MovieDataProvider + Movie, MovieSummary, Tag,
                            WatchProvider, ImageSize
lib/providers/tmdb.ts       the TMDB implementation
lib/providers/index.ts      `provider` and PROVIDER_NAME — the only import path
lib/supabase/service.ts     service-role client
lib/movies/cache.ts         cacheMovie(externalId) -> movies.id
scripts/tmdb-smoke.ts       verification
```

### Two interface methods deliberately get no table

`getWatchProviders` has no table in §3 at all — availability churns, so it is
fetched live and never cached. `nowPlaying`/`upcoming` likewise: they exist on
the interface because §2 defines them, but theatre mode is phase 9 and
`movie_releases` is deferred there.

### Write order is the correctness argument, not a transaction

`cacheMovie` writes **`movies` → `tags` → `movie_tags` → `movie_external_ids`
last**, and that order is load-bearing. The mapping row is the only lookup path,
so it is the commit marker: fail before it and the next call misses and
re-fetches cleanly. The reverse order is what breaks — a mapping with
`fetched_at` set but no tags, which nothing would ever re-fetch, silently
feeding phase 4's recommender a movie with no signal.

The worst case in this order is an orphaned `movies` row. At 4–6 users that is a
harmless leak, and it is why there is no Postgres function here: wrapping this
in an RPC would buy atomicity at the cost of a schema change, a grant and a
second place where the mapping logic lives.

A concurrent second call loses the `movie_external_ids` insert with `23505`;
that branch re-reads and returns the winning id rather than surfacing an error.

### Provider-shape decisions

- **`Provider` renamed to `WatchProvider`.** §2's signature returns `Provider[]`,
  which in a file that also defines `MovieDataProvider` reads as the wrong thing.
- **`Tag` carries no weight.** §4.1 applies the per-type weight (genre ×3,
  person ×2, keyword ×1) at *scoring* time from `tags.tag_type`, so
  `movie_tags.weight` stays at its column default of 1. Phase 4 reads the type.
- **`getTags` uses `append_to_response=keywords,credits`** — genres, keywords
  and people in one round trip, so a cache miss costs two TMDB calls, not four.
- **Person tags are the top 10 billed cast plus every `job === "Director"`,
  stored as names.** `tags` is unique on `(tag_type, tag_value)`, so two
  different people sharing a name merge into one tag. Storing a TMDB person id
  instead would break provider-agnosticism *and* §4.4's explanations
  ("3 of 4 love Christopher Nolan") read from this value. The collision is
  accepted.
- **`toTags` dedupes.** A director who also appears in the cast would otherwise
  trip "ON CONFLICT DO UPDATE cannot affect row a second time" on the `tags`
  upsert.

### The adapter retries connection failures, and only those

TMDB resets roughly **one connection in five** from this machine — measured 3
`ECONNRESET` in 15 sequential calls, reproducible across runs. The signature
(connection reset, not timeout or DNS failure) matches SNI-based filtering by
Indian ISPs, a known problem for TMDB; if that is the cause, Vercel's servers
will not see it and this is purely a local-development tax. Either way a 20%
failure rate behind phase 1b's add-to-list button is not something the caller
can do anything useful about, so `get()` retries twice with 200/400 ms backoff.

The retry is scoped to **network-level throws**. An HTTP error response is not
retried: a 401 or a 404 says the same thing the second time, and retrying it
would only slow down the failure.

Verified against a stubbed `fetch` rather than inferred from a healthy run:
one reset recovers in 2 calls (270 ms), two in 3 calls (603 ms), three exceed
`RETRIES` and throw after exactly 3 calls, and a 404 throws after 1. Before the
retry existed, a cold 11-film run lost two films; after it, the same run
completed 29 calls clean.

This is the one place phase 1a exceeded its plan, which had scoped retries out.
The 20% measurement is what changed the decision — it is a demonstrated failure
mode, not defensive coding against a hypothetical one.

### Field mapping, where TMDB and the column disagree

- **`release_date: ""`.** TMDB sends an empty string, not null, for an unknown
  date — the `date` column rejects it outright. Coerced to null, and `year` is
  derived from the coerced value so it comes out null rather than `NaN`.
- **`runtime: 0` and `vote_average: 0` → null.** Zero means "unknown" on both,
  not a zero-minute film or a film rated zero.
- **`rating_external` is `numeric(3,1)`, so Postgres rounds.** Verified: 8.456
  stores as 8.5. There is no rounding in TypeScript and there should not be.

All three are confirmed against live data, not just reasoned about: TMDB's
"Untitled Immaculate Reception Film" caches with `year`, `release_date`,
`runtime` and `rating_external` all null, and inserts without error.

### TMDB tag baseline (SPEC §2)

Measured over the nine curated films in `scripts/tmdb-smoke.ts`:

| | genre | keyword | person |
|---|---|---|---|
| 12 Angry Men (1957) | 1 | 22 | 11 |
| Avatar: The Way of Water (2022) | 3 | 21 | 11 |
| Free Solo (2018, documentary) | 3 | 19 | 10 |
| The Dark Knight (2008) | 3 | 18 | 11 |
| Parasite (2019, Korean) | 3 | 16 | 11 |
| Inception (2010) | 3 | 14 | 11 |
| Fight Club (1999) | 2 | 14 | 11 |
| Spirited Away (2001, animation) | 3 | 11 | 11 |
| Dilwale Dulhania Le Jayenge (1995) | 3 | 5 | 11 |

Keywords are 5–22 per film, so §4's recommender has real signal on every one.
The floor is the Indian title — worth remembering when phase 4 is tuned, since
DDLJ is exactly the kind of film this app's users will have on their lists.
This table is what any escape-hatch provider has to be measured against.

### Deferred, so later phases know where to look

- **No TTL on `fetched_at`.** §3 says fetch once on first sighting. The column
  is written and not yet read.
- **`search()` does not write through.** A row per result would insert dozens of
  movies per keystroke. The write-through fires on add-to-list (phase 1b).
- **No `provider='imdb'` rows.** `findByImdbId` resolves through TMDB's `/find`
  and caches under `'tmdb'`. Storing the IMDb mapping too only pays off for
  repeat imports, which is phase 8.
- **No generated `database.types.ts`.** Phase 0 produced none; the service
  client is untyped, so `cache.ts` names columns as string literals.
- **`getWatchProviders` returns no deep link.** TMDB's per-region payload has
  one `link`; the shape here is name/logo/type only. Phase 1b adds it if the
  attribution question below requires it.

### `tsx`, and why the smoke script needed a decision

Phase 1a has no UI, so verification is a script — and Node 22 runs `.ts`
directly, which looked like it made a runner unnecessary. It does not: node will
not resolve extensionless or directory imports, so plain `node` cannot load
`lib/movies/cache.ts` (`../providers`, `../supabase/service`). Adding `.ts`
extensions to fix that needs `allowImportingTsExtensions` in `tsconfig.json` and
pushes script-driven noise into app source.

`tsx` was added as a devDependency instead (asked first, per CLAUDE.md). It
reads `tsconfig.json`, so `@/` aliases work and **no source file changed to suit
the script**. Two consequences worth knowing:

- `tsx` pulls in `esbuild`, whose install script pnpm blocked pending policy.
  It is set to `false` in `pnpm-workspace.yaml` and listed under
  `ignoredBuiltDependencies` — esbuild works from its prebuilt platform package
  and does not need it. Until that placeholder was resolved, pnpm refused to run
  *any* script, including `typecheck`.
- `package.json` has no `"type": "module"`, so tsx transpiles to CJS and
  top-level `await` fails. The script ends in `main().catch(...)`.

### Env

`TMDB_API_KEY` holds a **v4 Read Access Token**, sent as `Authorization: Bearer`,
not the 32-character v3 key in a query parameter — it keeps the secret out of
request URLs and therefore out of any logging. `SUPABASE_SERVICE_ROLE_KEY` is
the service-role JWT; the newer `sb_secret_…` key works identically if preferred.
Neither carries `NEXT_PUBLIC_`; the repo is public and that prefix ships the
secret to the browser.

### Open, for later

- **JustWatch attribution is unconfirmed.** TMDB sources `/watch/providers` from
  JustWatch and attaches its own attribution condition, separate from §2's TMDB
  logo requirement. This phase starts fetching that data; the UI that displays
  it is phase 1b/7. Confirm the wording before that ships.
- **§2's ten-film test is half done.** The untested assumption is about
  *TheTVDB* keyword parity, which needs a TheTVDB key and adapter — beyond this
  phase's "interface + TMDB adapter". `scripts/tmdb-smoke.ts` establishes the
  TMDB side: per-film genre/keyword/person counts, failing loudly if any film
  returns zero keywords. The TheTVDB comparison itself is still owed before
  TheTVDB counts as a real escape hatch.
- Phase 0's note about `AGENTS.md`/`CLAUDE.md` listing pgvector no longer
  applies — both Stack lines now read
  "Next.js · Supabase (Postgres, Auth, RLS) · Tailwind · Vercel".
