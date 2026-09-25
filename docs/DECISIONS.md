# Decisions

**Current phase: 12**

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

### JustWatch attribution, and why `getWatchProviders` returns an object

Confirmed against TMDB's own reference for the watch-providers endpoint:

> "In order to use this data you must attribute the source of the data as
> **JustWatch**. If we find any usage not complying with these terms we will
> revoke access to the API."

This is stricter than §2's TMDB-logo condition — the penalty is losing the API,
and it attaches to the data itself, so it binds the moment anything is
displayed. TMDB's guidance is to attribute **both** JustWatch and TMDB, with a
reference or logo on each item showing providers.

The endpoint also returns a per-region `link`. It is a **TMDB** watch-page url
(`themoviedb.org/movie/27205-inception/watch?locale=IN`), *not* a JustWatch deep
link — TMDB does not hand those out. So the attribution and the link are two
separate obligations, and satisfying one does not satisfy the other.

`getWatchProviders` therefore returns `WatchAvailability`
(`{ link, providers }`) rather than §2's bare `Provider[]`: `link` is
per-region, not per-provider, and dropping it would leave phase 1b unable to
link out at all. This is the second documented departure from §2's signature,
after the `Provider` → `WatchProvider` rename.

Nothing renders yet, so nothing is out of compliance today. **Phase 1b/7 owes
the attribution UI before any watch-provider data reaches a screen.**

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

- **JustWatch attribution — confirmed, and it is a hard licence condition.**
  Resolved; see the section above. What remains is the *rendering*, which is
  phase 1b/7: attribute JustWatch next to any watch-provider display, and link
  out via `WatchAvailability.link`.
- **§2's TheTVDB keyword-parity test — dropped, deliberately.** §2 asks for it
  "during phase 1a". It is not being done, and this is the decision not to.

  The escape hatch only matters if TMDB's licensing forces a switch, which is a
  monetization problem — phase 12. At zero revenue the developer key is
  legitimate, so the contingency is years from binding. The expensive half of
  provider-swappability, the `MovieDataProvider` interface, is already built and
  paid for; only the comparison is deferred.

  What makes it cheap to resume: `scripts/tmdb-smoke.ts` records the TMDB side
  as a table in this document (5–22 keywords per film). Any candidate provider
  gets measured against that. Note TheTVDB is TV-first and this app is
  movies-only, and its v4 auth exchanges an API key for a bearer token that
  **expires monthly** — an adapter would need a refresh, unlike TMDB's static
  token.

  The real question to settle first is the §2 email to TMDB: whether a
  zero-revenue *public* app is acceptable on a developer key. That answer
  determines whether an escape hatch is ever needed at all.
- Phase 0's note about `AGENTS.md`/`CLAUDE.md` listing pgvector no longer
  applies — both Stack lines now read
  "Next.js · Supabase (Postgres, Auth, RLS) · Tailwind · Vercel".

---

## Phase 1b — search UI, add to list, list views

**No schema change.** `lists`, `list_items` and the catalog tables already
carried every column and RLS policy this phase needed; it only had to be
called correctly from real UI for the first time.

```
app/page.tsx                           My List view (was the phase-0 JSON dump)
app/search/page.tsx                    search screen
app/search/actions.ts                  searchMovies
app/list/actions.ts                    addToList, removeFromList
components/movie-card.tsx              shared poster/title/year card
components/search-form.tsx             debounced input + results grid
components/add-to-list-button.tsx      calls addToList, inline feedback
components/remove-from-list-button.tsx calls removeFromList
```

### Scope decisions, confirmed with the user before building

- **Live debounced search**, not an explicit submit button — 300 ms, 2-char
  minimum, hand-rolled with `useEffect`/`setTimeout` and a ref-guarded request
  counter so a slow earlier response can't clobber a newer one. No new
  dependency; the project has no debounce/query library and CLAUDE.md requires
  asking before adding one.
- **Remove-from-list is in phase 1b's scope**, even though SPEC §9's phase row
  only names "add to list." The `list_items_delete_via_list` RLS policy
  already existed from phase 0 for exactly this, so leaving it unused until
  some later phase would be building the policy twice — once now unused, once
  later wired up.
- **`app/page.tsx` is now the real My List screen** (SPEC §7 screen 3),
  replacing the phase-0/1a proof-of-RLS JSON dump. That dump had already done
  its job (proving grants+policies line up end to end); phase 1b's own list
  view is a strictly more useful version of the same proof.
- **One list only.** "Add to list" always targets the caller's `is_default`
  list. There is still no UI for creating or choosing among multiple lists —
  nothing in this phase's scope calls for one, and the schema's
  one-default-list guarantee (`lists_one_default_per_owner_idx`) makes "the
  user's list" well-defined without it.

### Mutations run as the authenticated user, never as service-role

`addToList` and `removeFromList` (`app/list/actions.ts`) use
`createClient()` (`lib/supabase/server.ts`, cookie/RLS-scoped) for every
`lists`/`list_items` read and write. `cacheMovie` is the one exception inside
`addToList` — it still runs service-role internally, as phase 1a built it,
because it only ever touches the catalog tables, which are unwritable by
`authenticated` by design. Using the authenticated client for `list_items` is
load-bearing, not stylistic: that table's RLS *is* the ownership check
(`list_items_insert_via_list`/`_delete_via_list` join back to `lists.owner_user_id`).
A service-role insert would bypass the exact policy phase 0 wrote pgTAP
assertions for.

### Duplicate add is success, not an error

`list_items`'s primary key is `(list_id, movie_id)`. Clicking "Add" on a movie
already on the list hits `23505`. `addToList` special-cases that code into a
distinct `"already-in-list"` result rather than surfacing a thrown error —
re-adding an already-listed movie is an expected path (the same movie can
appear in two searches, or a double-click), not a failure.

### `movies` comes back as an object, not an array — and postgrest-js's types disagree

`list_items.movie_id → movies.id` is many-to-one from `list_items`'s side, so
PostgREST embeds `movies` as a single JSON object on every row. Without a
generated `database.types.ts` (still true — see phase 1a's note), postgrest-js
can't determine that cardinality from the select string alone and types the
embed as `{ ... }[]`, which fails `tsc` the moment a field is accessed.

Verified against the *running* local stack before deciding this was a types-only
problem and not a real shape mismatch: a script authenticated as a real
signed-in user (JWT from a real magic-link round trip) ran the exact query
`app/page.tsx` uses and printed a single object under `movies`, not an array.
`app/page.tsx` therefore declares a local `ListItemRow` type and casts the
query result (`as unknown as ListItemRow[]`) — the same style `lib/movies/cache.ts`
already uses for the same underlying reason (no generated types), rather than
indexing `movies[0]`, which would silently do the wrong thing if the cardinality
inference is ever right for a different query.

### Images: plain `<img>`, not `next/image`

CLAUDE.md: "Never re-host images. Hotlink the provider CDN." `next/image`
proxies through Vercel's image-optimization endpoint by default, which is a
re-host in every sense that matters here (it fetches, transforms and caches
the bytes on Vercel's infra). `components/movie-card.tsx` uses a plain `<img>`
pointed at `provider.getImageUrl(path, "w185")` (a direct
`image.tmdb.org` URL) instead, with an eslint-disable on `@next/next/no-img-element`
for that one line, since the rule's default suggestion is exactly the thing
the hard rule forbids.

### Verification: no browser available in this session

This is the first phase with real UI, and CLAUDE.md calls for testing the
feature in a browser before calling it done. This session had no connected
Claude-in-Chrome extension (headless/background environment), so that step
could not be done as literally specified. In its place:

1. `pnpm typecheck` and `pnpm lint`, clean.
2. A full magic-link round trip via curl against the local stack + Mailpit —
   real OTP email, real `/auth/confirm` redirect, real session cookie.
3. `/` and `/search` fetched with that session's cookies, confirming both
   server components render (auth guard, empty-list state, search markup) with
   no runtime error, against the real local Supabase project.
4. A throwaway script (not committed), authenticated with that session's real
   access token, ran the *exact* queries `addToList`, `removeFromList` and the
   `list_items` join in `app/page.tsx` use — default-list lookup, `cacheMovie`,
   insert, duplicate insert (confirmed `23505`), the joined select (confirmed
   the `movies` object shape above), delete, and the post-delete state. All
   matched expectations under real RLS as a real authenticated user.

What's still unverified: the actual client-side debounce timing and button
click interactions, since nothing in (1)-(4) drives real DOM events. A live
click-through is worth doing before treating phase 1b as fully closed.

### Visual design pass

Phase 1b's first cut (above) was bare Tailwind carried over from the login
boilerplate — functional, no identity. A follow-up pass gave it one, grounded
in the one thing every other movie-app UI wouldn't reach for: the product's
own name.

**The signature is the name.** "Venn" is two circles overlapping, so that's
the whole visual system, not a decoration bolted on afterward:

- Two identity hues, `circle-a` (`#F2545B`, coral) and `circle-b` (`#4C6FFF`,
  periwinkle), plus `overlap` (`#9F61AD`) — the literal RGB midpoint of the
  two, computed rather than picked, used as the single accent for every
  primary action (buttons, focus rings, the search input's active state).
- `components/venn-mark.tsx` — two overlapping circles (`circle-b` at 75%
  opacity over `circle-a`, so the overlap region is a real optical blend, not
  a third hand-picked fill) is both the wordmark *and* the "just added to your
  list" success state on `AddToListButton`. Clicking Add plays the two circles
  sliding in from opposite sides to settle into the overlap
  (`venn-slide-a`/`venn-slide-b` keyframes, `motion-safe`-gated) — the one
  deliberate animated moment in the app; everything else is quiet by
  comparison (a short `rise-in` stagger on grid load, plain opacity/scale
  transitions on hover).
- Explicitly avoided the three directions any AI-assisted pass defaults to:
  cream+serif+terracotta, near-black+single-neon-accent, and zero-radius
  broadsheet. Venn is dark-first (movie night, evening use) but with a tinted
  near-black (`#15121C`, not true black) and *two* hues resolving into a third
  rather than one flat accent, and leans into circles/pills throughout instead
  of hard edges.

**No new dependencies.** Both typefaces are the Geist Sans/Mono already loaded
in `app/layout.tsx` — personality comes from scale, weight and the color
system, not a new webfont. All tokens are plain CSS custom properties
registered via Tailwind v4's `@theme inline` in `app/globals.css`
(`--color-bg`, `--color-surface`, `--color-fg` families, each with a
`prefers-color-scheme: dark` override, plus `--color-circle-a/b/overlap`) —
no UI kit.

**`components/app-header.tsx`** is new and shared by `/` and `/search`
(and, since this last, `/login` too) — the wordmark + subtitle + nav-actions
block was identical on both and would have drifted otherwise.

**Images stay plain `<img>`** (see above) — the redesign didn't change that,
only restyled around it (rounded-2xl poster, hover glow using the same
`circle-a`/`circle-b` pair blurred behind the corners).

**Verification, same constraint as above:** still no Claude-in-Chrome
extension in this session. This time, headless `google-chrome` (the system
binary, not a new project dependency) drove a real magic-link sign-in and
screenshotted the running dev server — empty My List, a populated list seeded
with three real TMDB titles, the search screen's gradient-border input, and
`/login`. All four confirmed the token system, `VennMark`, and layout render
as designed. **Not confirmed:** hover states, the add-button merge animation,
and focus-ring appearance — headless screenshot mode doesn't simulate mouse
or keyboard input. Worth checking in a real browser alongside the phase 1b
click-through already owed above.

---

## Phase 2 — unified vote + watched status

**No schema change.** `user_movie_status` was built whole in phase 0 — table,
`vote_matches_watched_state` check, grants, all four RLS policies, pgTAP
coverage. Nothing had ever written a row until this phase.

```
app/status/actions.ts        setWatched, setRating, setHype
components/vote-control.tsx  the rating/hype segmented row
components/watched-toggle.tsx  corner pill, mirrors RemoveFromListButton
components/list-filter.tsx   chip strip, reads/writes the `filter` searchParam
```

`components/movie-card.tsx` gained one optional `footer` slot for the vote
row; the existing `children` slot still renders the corner overlay, now
`WatchedToggle` + `RemoveFromListButton` together. `app/page.tsx` reads
`searchParams.filter`, extends the existing list-items query with a nested
`user_movie_status(...)` embed, and filters in TypeScript.

### Why no `updated_at` trigger

`updated_at` is `default now()` with nothing bumping it on update — the
textbook fix is a `BEFORE UPDATE` trigger. Not added: nothing reads that
column yet (`hype_history.recorded_at` and phase 12's hype-vs-reality stats
are the eventual readers), and all three actions set it explicitly, so it's
already correct everywhere it can currently be written. Revisit when phase 8's
import becomes a second writer to this table.

### `setWatched` clears both vote columns

The check constraint requires clearing one of `rating`/`hype` on every write
(whichever the new `watched` value doesn't allow); the only real choice was
whether to preserve the *other* one across a flip. It doesn't: keeping a stale
`love` on a row the user just un-watched would show a rating for a film they
just said they haven't seen. Flipping watched resets the vote.

### `setRating` updates; `setHype` upserts

Not an inconsistency — it falls out of which states can exist without a row
already present. *Unwatched, no vote* is the implicit default for every movie
in the catalog, so a hype vote is what has to create the row. `watched = true`
only ever exists because `setWatched` already created it, so `setRating` only
ever updates. Passing `rating: null` / `hype: null` clears the vote — clicking
an already-selected choice deselects it, per §8's "the vote is prompted, never
blocking."

### Filtering runs in TypeScript, not SQL

`unwatched` means *no status row at all, or `watched = false`* — PostgREST's
embedded-filter syntax (`!inner`) can't express "no row," since an inner join
drops exactly the rows that have none. The page also has no pagination and
already fetches the list whole, so there's nothing to save by pushing the
filter into the query. This is a documented scale limit, not a general claim —
it stops being adequate the day this list paginates.

### The `user_movie_status` embed actually is an array

Phase 1b's `movies` embed needed a cast (`as unknown as ListItemRow[]`)
because `list_items → movies` is many-to-one and postgrest-js can't infer
that without generated types. `movies → user_movie_status` is genuinely
to-many (0 or 1 row per caller, RLS-scoped) — verified directly (see below)
before relying on it — so the array here is the correct shape, not a types
artifact. `ListItemRow` takes `user_movie_status[0] ?? null`.

### Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm build` — all clean. Unlike phase 1a's
   files, `pnpm build` does exercise these: `app/page.tsx` imports all of them.
2. Real magic-link round trip against the local stack + Mailpit, twice (a
   second user, needed for the RLS-denial check below).
3. A throwaway script (not committed), authenticated with each session's real
   access token so every statement ran as a real `authenticated` user under
   RLS: `setHype` creating a row from nothing, `setWatched(true)` clearing hype
   and stamping `watched_at`, `setRating("love")` leaving `watched_at`
   untouched (the assertion that pins the update-vs-upsert split above),
   `setWatched(false)` clearing rating and nulling `watched_at`,
   `setRating(null)` clearing the vote without deleting the row, a
   hand-crafted `(watched: true, hype: set)` write confirmed rejected with
   `23514`, the joined `list_items` select confirmed `movies` as an object and
   `user_movie_status` as an array, and — with a second real user's session —
   confirmed that user cannot read the first user's status row by `user_id`.
   All passed.
4. No Claude-in-Chrome extension connected at first in this session (same
   constraint as phase 1b). Fell back to headless `google-chrome` against a
   real signed-in session: seeded one user's list with movies across every
   vote state (three ratings, one unvoted-watched, three hype levels) through
   the same RLS-scoped path as (3), then screenshotted `/`, `/?filter=love`,
   and `/?filter=unwatched`. Confirmed: correct chip counts, correct
   rating/hype button selected per movie (including `hate` rendering in
   `circle-a` rather than `overlap`), the watched toggle filled for watched
   movies, and the section+value chip hierarchy narrowing the grid correctly.

   The extension reconnected later in the same session, closing the gap
   phase 1b left open. Driven with real clicks (not scripted requests): a
   full magic-link sign-in (typed email, clicked send, clicked the actual
   link in Mailpit), live TMDB search including one real ECONNRESET recovered
   by the documented retry, add-to-list settling into the Venn-mark success
   state, the watched toggle flipping and clearing the opposite vote column,
   `hate` selecting/deselecting in `circle-a`, and a filter chip click
   navigating to `?filter=watched` with correct sub-chip counts. Separately
   confirmed: the movie-card hover glow, the remove-button's hover
   scale/color change, and a real `:focus-visible` ring (tab-order landed on
   it, `overlap`-colored outline, 2px, correct offset) — closing phase 1b's
   last open item (hover states, focus-ring appearance) as well as this
   phase's live-interaction gap.

---

## Phase 3 — groups, invite codes, group lists, multi-user RLS

Migration: `supabase/migrations/20260726132508_phase3_groups.sql`.

The first phase where more than one person touches the same row. Phases 0–2
were single-user by construction: every policy reduced to `x = auth.uid()`, and
`profiles_select_own` meant a user could not see that anyone else existed.

```
groups                id, name, invite_code UNIQUE, created_by, created_at
group_members         group_id, user_id, role (owner|member), joined_at
lists                 owner_user_id now NULLABLE, + owner_group_id,
                      + check num_nonnulls(owner_user_id, owner_group_id) = 1
```

That `lists` ALTER is the one phase 0 named and deferred to here — it *is*
"group lists". It validated against the existing rows without a backfill
(they all have `owner_user_id` set, `owner_group_id` null → `num_nonnulls = 1`);
verified by dropping and re-adding the constraint with a phase-0-shaped row
present, rather than assumed.

### `is_group_member` is the recursion break, and takes one argument

A `group_members` SELECT policy that queries `group_members` recurses forever.
`public.is_group_member(gid uuid)` is `SECURITY DEFINER`, so it short-circuits
that, and every widened policy goes through it.

It takes **only the group id and reads `auth.uid()` internally**. A
`(gid, uid)` signature would turn it into a membership oracle any authenticated
user could probe over `/rest/v1/rpc/`; as written, the only question it can
answer is about the caller.

Unlike `handle_new_user` — revoked from everyone, because only a trigger calls
it — this one **needs `grant execute to authenticated`**: policies are
evaluated as the invoking role, so without the grant every widened policy fails
with `permission denied for function`.

### Both writes into `group_members` are SECURITY DEFINER, so it has no INSERT grant

- **Creating a group** → `handle_new_group()`, an `AFTER INSERT` trigger on
  `groups` mirroring phase 0's `handle_new_user`: it inserts the creator's
  `owner` membership and the group's one list.
- **Joining a group** → `join_group_by_code(p_code)`. A non-member *cannot*
  select a group by its code — a policy permitting that would have to be
  readable by everyone, which is the thing an invite code exists to avoid — so
  the lookup has to run as definer. It `upper(trim(...))`s the code (verified:
  joining with a lowercased, space-padded code works) and returns `null`, not
  an error, for an unknown code.

Because neither path is a plain insert, `group_members` is granted only
`SELECT` to `authenticated` and carries no INSERT policy at all. Same "no write
policy is the enforcement" argument phase 0 made for the catalog tables, and
pgTAP pins it: a member cannot add another member directly (`42501`).

A group with no members and no list is not reachable. `groups.created_by`
references `profiles(id)`, so a bad creator is rejected by the FK *before* the
trigger ever runs — checked, not assumed: inserting a group whose `created_by`
has no profile fails with `groups_created_by_fkey` and leaves zero rows. And
because the trigger is `AFTER INSERT ... FOR EACH ROW`, any failure inside it
aborts the same statement, taking the `groups` row with it.

`groups` likewise gets only `SELECT, INSERT` — no UPDATE or DELETE for anyone,
which is what keeps renaming/leaving/deleting a group genuinely out of scope
rather than merely unbuilt.

### Which policies widened, and the one that deliberately did not

| table | before | after |
|---|---|---|
| `profiles` | own row | own row **or** a shared-group peer |
| `lists` | `owner_user_id = uid` | that **or** group-owned by a group I'm in |
| `list_items` (×4) | parent list is mine | parent list is mine **or** my group's |
| `user_movie_status` | own rows | **unchanged** |

`user_movie_status` is the deliberate one. SPEC §11: a user must not read
another's private ratings. Sharing a group does not change that — phase 4's
recommender reads them server-side, which is phase 4's problem, not a reason to
open the table now. A pgTAP assertion pins it from inside the group.

`lists_insert_own` / `_update_own` / `_delete_own` were left byte-identical.
`auth.uid() = owner_user_id` is NULL — therefore false — for a group-owned row,
so group lists can only be born from the trigger and only die by cascade. A
pgTAP assertion confirms a member cannot hand-create a second list for the group.

`list_items_insert_via_list` **keeps `added_by = (select auth.uid())`**. That
clause is the reason "who added what" can be trusted; without it a member could
attribute an add to somebody else. Pinned with a third film so the assertion
fails on the policy rather than on `list_items`' primary key.

Widening `profiles` exposes *every* profile column to group peers,
`default_list_visibility` included. Acceptable at 4–6 friends; phase 10's
visibility toggles are where that gets a real answer.

### RLS scopes what you *may* see, not what you *asked for* — twice

Both bugs this phase produced are the same mistake, and neither is caught by
`typecheck`, `lint` or `build`:

1. **`.eq("is_default", true).single()`** in `app/page.tsx` and both actions in
   `app/list/actions.ts`. Once `lists_select` returns group lists too, a second
   `is_default` row would make `.single()` throw `PGRST116` — for group members
   only. Two independent fixes, both applied: group lists carry
   `is_default = false` (uniqueness comes from a new
   `lists_one_per_group_idx`, because `lists_one_default_per_owner_idx` is
   `on (owner_user_id) where is_default` and NULLs are distinct in a unique
   index, so it stops enforcing anything the moment the column is nullable),
   **and** all three queries are now scoped with `.eq("owner_user_id", userId)`.
   Verified as a counterfactual, not by reasoning: forcing the group list to
   `is_default` makes the phase-1b query return 2 rows while the scoped query
   still returns 1.
2. **`group_members` with no `user_id` filter** in `app/groups/page.tsx`.
   `group_members_select_peers` returns every member of every group you are in,
   so "my groups" listed each group once *per member* — caught only by
   rendering the page as two users who share a group.

The pattern is worth carrying into phase 10, which widens `lists_select` again.

### Add-to-group is a search param, not a picker

`/groups/[id]` → "Add movies" → `/search?list=<listId>`, and
`addToList(externalId, listId?)` / `removeFromList(movieId, listId?)` take it
through. No dropdown; nothing else in the phase needed one.

The `listId` is **not trusted** — `list_items_insert_via_list` is the
enforcement, exactly as phase 1b established for the personal list. Confirmed
end to end: a non-member who is handed the group's list id gets the generic
search screen (the `lists` lookup returns nothing for her) and a hand-crafted
insert is refused with `42501`.

**`revalidatePath("/groups/[id]", "page")`, not `("/groups", "layout")`.** The
first version of this used the layout form and it was wrong: per Next's own
reference, `'layout'` "invalidates any path that matches the provided **layout
file**", and there is no `app/groups/layout.tsx` in this app. The page-file form
is the documented way to invalidate a dynamic route, and it matches every
`/groups/<id>`. `setDisplayName` calls both, since a name change shows up on
`/groups` (the form's own value) and on every group page (member chips and
"added by").

The bug this avoids is client-side only, and worth being precise about: the
build marks `/groups/[id]` as `ƒ` (server-rendered on demand), so there is no
server cache entry to go stale — verified, plain and `RSC: 1` fetches both
render the current item count. What `revalidatePath` clears here is the **client
Router Cache**, which is what a `<Link>` back-nav from `/search?list=…` reads.
That specific back-nav was **not** re-driven in a browser after the fix (the
extension disconnected); the correction rests on the documented semantics plus
the dynamic-route evidence above.

### Display names, and why not a backfill

Groups are the first screen where other people see you, and onboarding (§7
screen 2, which sets `username`/`display_name`) is phase 8. Rather than edit
phase 0's `handle_new_user` to seed a name from the email local-part — which
would leak the local-part to every group peer — `/groups` carries a single
"You appear to groups as" input. `profiles_update_own` already permitted the
write, so this cost no schema change. Everything renders
`display_name ?? "Member"`.

### Deferred, deliberately

- **`groups.visibility` (`invite|public`)** is in §3 but is not built. Phase
  12's "joinable groups" widens a *policy*, not the schema, and phase 0's own
  precedent is not to carry a column that can never take its second value.
- **Leaving, renaming and deleting a group.** Not in §9's phase 3 deliverable,
  and leaving opens the last-owner question. The absent UPDATE/DELETE grants
  are what keep this honest rather than merely unimplemented.
- **No rate limit on `join_group_by_code`.** 8 hex chars is ~4.3e9 codes, so
  brute-forcing one is impractical, but the RPC is callable in a loop by any
  signed-in user. Worth a limit before public launch, alongside §11's
  `/api/ingest` limit.

### Tests

`supabase/tests/rls.test.sql`, now **42** pgTAP assertions (was 20). Four
actors: phase 0's A and B, who share nothing, plus C and D, who share a group —
so A is the natural non-member for every group negative and its existing
"A sees exactly one profile / one default list" controls stay true.

SPEC §11's named test is covered: a non-member cannot read the group (and
therefore not its invite code), its membership, its list, or its items, and
cannot insert into it.

The controls remain load-bearing, and this was re-verified rather than assumed:
blanking `request.jwt.claims` fails exactly 6 of A's controls, and D's entire
block — every assertion in it is a positive — aborts the transaction outright
at `join_group_by_code`, which raises `not authenticated`. Nothing passes for
the wrong reason.

Phase 0's `'A cannot add an item to B''s list'` assertion is still green. It is
flagged there as the predicate this phase rewrites, so it was the regression
guard for the `list_items` widening.

**The suite requires a fresh database.** Phase 0's fixtures hardcode `tags`
id 1 and assert exact `movies` counts, so once the local catalog has real rows
(after `pnpm smoke:tmdb`, or any use of the app) the fixture insert collides and
the run reports the confusing `Bad plan. You planned 42 tests but ran 0`. Run
`supabase db reset` first. Left as-is rather than rewritten — that is phase 0's
design, not phase 3's mess.

### Verification

1. `supabase db reset` → both migrations apply clean; `supabase test db` →
   42/42.
2. `pnpm typecheck`, `pnpm lint`, `pnpm build` — all clean, and unlike phase 1a
   the build does exercise these files.
3. Three real magic-link sessions against the local stack + Mailpit. Every
   `groups` / `group_members` / `lists` / `list_items` / `profiles` statement
   the new code issues was run over PostgREST with each user's **real** access
   token, so all of it was evaluated under RLS as a genuine `authenticated`
   user. This is also what pinned the embed shapes with no generated
   `database.types.ts`: `group_members → groups` and `list_items → profiles`
   both come back as **objects**, `movies → user_movie_status` as an array.
4. Every page rendered as all three users. Alice (owner), Bob (member) and
   Carol (in no group): Carol gets a real 404 on `/groups/<id>`, an empty
   `/groups`, and the generic search screen when handed the group's list id.
5. The `PGRST116` counterfactual above — invisible to steps 1–3.
6. **Live browser click-through** (Claude-in-Chrome, connected this session): a
   real magic-link sign-in typed and clicked through the UI, joining with a
   **lowercased** invite code, landing on the group page, "Add movies" →
   debounced TMDB search → add settling into the Venn-mark success state,
   returning to the group to see *"added by Bob"* rendered from the widened
   `profiles` policy, a hype vote persisting on the group card, and My List
   still resolving correctly while in a group. No console errors.
   Not confirmed: the invite-code copy button — `navigator.clipboard` is
   unavailable on plain `http://localhost` in this browser, and the failure is
   swallowed by design (the code is on screen either way).
7. Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP, same route and
   same reason as phase 0. `apply_migration` stamped `20260726132508`, and the
   local file was renamed from `20260726115639` to match so a later
   `supabase db push` does not re-run it. Local and remote then produced the
   same fingerprint over all columns, policies, grants, functions, constraints
   and indexes (`f1c7ea42bcc45f95355835cd4df340d8`, 170 objects).

### Supabase advisors: two expected WARNs

`get_advisors(security)` flags both new functions under
`authenticated_security_definer_function_executable`. Both are intentional and
cannot be "fixed" without removing the feature:

- `is_group_member` **must** be executable by `authenticated`, or every widened
  policy fails. Its single-argument signature is what makes the RPC exposure
  harmless: the only question it can answer is about the caller, and it returns
  **`false` identically** for a group that does not exist and for a real group
  the caller is not in — so it is not an existence oracle for other people's
  groups either. Verified over `/rest/v1/rpc/is_group_member` with a random
  uuid, the caller's own group, and a real group the caller had not joined:
  `false`, `true`, `false`.
- `join_group_by_code` **is** the join endpoint; being callable is the point.
  The open item there is the rate limit noted above, not the grant.

---

## Phase 4 — tag weights, Top-3 recommender, explanations, reroll

Migration: `supabase/migrations/20260726154439_phase4_recommender.sql`.

The first phase that **reads across users**. Phase 3 widened `profiles`, `lists`
and `list_items` to "my groups too" and deliberately left `user_movie_status`
alone, noting that "phase 4's recommender reads them server-side; that is phase
4's problem." This is that answer.

```
user_tag_weights   user_id, tag_id, weight (real)
                   PK (user_id, tag_id)          -- §3, verbatim

_rebuild_tag_weights(p_uid)      private worker, §4.1
rebuild_user_tag_weights()       public wrapper, no args
recommend_movies(gid, present[], exclude[])   §4.2-§4.4
```

```
app/groups/[id]/night/page.tsx   Movie Night (§7 screen 6), home mode
components/present-picker.tsx    who's here, as a searchParam
lib/recommend/explain.ts         components -> §4.4 prose
app/status/actions.ts            rebuild after setRating / setWatched
```

### The return shape is the privacy boundary

`recommend_movies` is `SECURITY DEFINER` and reads every present member's
ratings, hype votes and tag weights. It returns **only per-candidate
aggregates** — counts, one tag name, a score. No per-member row ever leaves it.

That is what let this phase widen **no policy at all**: `user_movie_status` is
as closed as phase 3 left it, and `user_tag_weights` arrives equally closed.
Confirmed with real sessions (below): while the recommender was demonstrably
using Bob's ratings, Alice read 0 of Bob's status rows and 0 of his tag weights.

Two guards, both `42501`: the caller must be a member (`is_group_member`), and
every uuid in `p_present` must be a member too. Without the second, a caller
could pass any uuid and read a stranger's taste back off the scores.

`user_tag_weights` gets `SELECT`-own and **no write grant or policy** — the same
"absence is the enforcement" argument phase 0 made for the catalog tables and
phase 3 for `group_members`. Nothing but `_rebuild_tag_weights` can write it, so
a weight is always exactly the derived function of that user's ratings,
including for the user themselves. pgTAP pins that a user cannot write even
their own row.

### Applying a weight twice is the failure mode, and it is silent

Both traps are commented in the migration where they happen, not only here:

- **`tag_type_weight` is applied at rebuild and only there.** `lib/movies/cache.ts`
  carries a phase-1a comment saying the per-type weight applies "at scoring
  time"; §4.1 is explicit that it applies when weights are built, and the spec
  wins. Doing both makes a genre count 9x.
- **`movie_tags.weight` is not a factor in the rebuild.** §4.1's formula omits
  it; §4.3's includes it. It belongs to scoring only.

A third, less obvious one: `sum()` over integers is `bigint`, and `bigint /
bigint` is integer division. Without the cast to `numeric` every weight would
silently truncate.

### Order of operations inside the scoring CTEs

Exclusions (watched-by-any-present, plus the reroll list) happen **before**
`taste` normalizes. Normalizing over the pre-exclusion set produces different
numbers and is an easy accident. §4.3 calls the normalize step not optional:
raw goes negative (`hate` is −2) while hype sits in [0.25, 1].

Two more that fall out of phase 2's behaviour rather than §4's text:

- **`coalesce(hype_score, taste)`, with the join requiring `hype is not null`.**
  Phase 2 built `setHype(null)`, so rows with `watched = false, hype = null`
  genuinely exist. They must fall through to taste; a null score there would
  poison both `min` and `avg`. Verified: a member with a *cleared* hype vote
  scores identically to a member with no row at all.
- **`coalesce(raw, 0)`** so a candidate sharing no tag with a member still takes
  part in that member's min/max window.

### Cold start, and where the min-term exclusion is computed

§4.5: "a member with no tag weights is excluded from the `min` term." That is a
per-**member** property, so it is resolved once in a CTE over `present`, never
inside the per-candidate aggregate — a per-candidate predicate would drift
between candidates and make their scores incomparable, which is the one thing
the normalize step exists to guarantee. When *no* present member has weights,
`min` falls back to all of them (verified: every score comes out 0.5).

This matters more now than it will later: onboarding's 10-movie rating gate is
phase 8, so until then a member with zero ratings is the common case, not the
edge case. Phase 8 makes empty weights impossible and this branch goes quiet.

### §4.3's "one config file" is unsatisfiable, and the conflict is the spec's

§4.3 asks for one config file; §1 and §10 require that scoring be plain SQL over
the normalized tag tables. No TypeScript config can reach inside a SQL function,
and it could not cover the rebuild half regardless. §1 wins: all six weight
groups sit in one labelled block at the top of the migration, and tuning them is
a migration.

That block is an **index of where each group lives**, not a copy of the values —
a comment that repeats a number is a comment that will eventually disagree with
it. The §4.4 *explanation* thresholds are the part that does live in TypeScript
(`lib/recommend/explain.ts`), where tuning is free.

### Deferred, deliberately

- **`hype_history`.** Phase 0's note said "→ 4", but §4 scores *current* hype off
  `user_movie_status` and never reads history. Phase 0's actual rule — defer a
  table to the phase that first consumes it — puts it in phase 12's
  hype-vs-reality stats. **The honest cost: history cannot be reconstructed
  retroactively, so phase 12 starts from empty.** If that matters, the table has
  to land before then, not when it is first read.
- **`movie_nights` / `movie_night_attendees` / `watch_confirmations`.** §9's
  phase-4 row stops at "reroll". §7 screen 6's "pick → logs night, prompts
  confirmations" *is* §8's watch-confirmation flow, which phase 0 deferred to 11.
  So who is present is transient UI state, and `user_tag_weights` is this
  phase's only new write path.
- **§4.2's widen step.** Asked and decided this session: it needs a new
  `MovieDataProvider` method (a third departure from §2's interface) plus a
  `cacheMovie` per pulled title — 2 TMDB calls each, against the ~20%
  ECONNRESET rate phase 1a measured. The picker returns fewer than 3 instead,
  which the browser pass confirms renders fine.
- **Personal lists in the candidate pool.** §4.2 says "movies on any list in the
  group", which is lists *owned by* the group. Reading members' personal lists
  is what phase 10's visibility toggles exist to govern.
- **"None of these" logging** (§4.5) — analytics, phase 11.

### §4.4's explanations are mildly de-anonymising in a small group

"1 of 2 love X", plus your own vote, tells you the other person's. The spec
mandates these explanations and the group is 4–6 friends who opted in, so this
is **accepted, not fixed**. `MIN_PERSON_COUNT = 2` in `explain.ts` suppresses
the sharpest case (a lone member's preference named outright), which is a
threshold worth revisiting alongside phase 10.

### The two environments disagree about *function* grants too

Phase 0 documented that hosted and local Supabase default in opposite directions
for **table** privileges. The same is true for **functions**, and no migration
had accounted for it: hosted carries `ALTER DEFAULT PRIVILEGES` granting EXECUTE
on new functions to `service_role`, and because that is a *direct* grant,
`revoke execute ... from public` does not remove it.

Phase 4's three functions now name `service_role` in their REVOKE, and the
revoke was applied to the remote separately (it postdates the applied
migration). That leaves the remote's stored migration text older than the file
in this repo — **exactly the divergence phase 0 documented for its own
revoke/grant block**, and it matters for the same reason: `db push` compares
versions rather than contents, so this is cosmetic, but a `supabase db pull`
after linking would re-baseline from the *stored* text and silently drop the
three `service_role` revokes. Re-add them if that ever happens.

Verified by a per-category fingerprint over columns, policies, table
grants, function bodies, function ACLs, constraints, indexes and RLS flags —
**all 8 categories are byte-identical across local and hosted**
(`74cc79bc708a187a10cd3e5d435b9946`, 200 objects each).

`fnacl` needed a second pass to get there. The first fingerprint after this
phase's migration showed it as the sole delta: phase 0's and phase 3's four
functions — `handle_new_user`, `handle_new_group`, `is_group_member`,
`join_group_by_code` — carried `service_role=X` on hosted and nothing locally,
for the same reason phase 4's own three functions initially did. It predates
this phase (their migrations never named `service_role` in a REVOKE, since
default-privilege behaviour for *functions* wasn't documented until this
phase's own discovery), so it was left recorded rather than silently
patched over. Once flagged, the user asked for it closed, and applying

```sql
revoke execute on function public.handle_new_user()        from service_role;
revoke execute on function public.handle_new_group()       from service_role;
revoke execute on function public.is_group_member(uuid)    from service_role;
revoke execute on function public.join_group_by_code(text) from service_role;
```

directly to `vfkkpflenfpfrrygxmto` (not a new migration file — these four
functions' migrations are already applied, and this only tightens a grant they
already govern) brought the fingerprint to a full match. It grants
`service_role` nothing it lacks — that key bypasses RLS by design — so this was
a tidiness fix, not a correctness one.

Worth noting for the record: phases 0 and 3 both claimed matching fingerprints
at the time. Those claims were true for what they measured — function ACLs
were not in either fingerprint. That was a gap in the earlier verification, now
closed, not a regression.

### Tests

`supabase/tests/rls.test.sql`, now **56** pgTAP assertions (was 42).

Every phase-4 negative has a paired positive control on the same table: D cannot
read C's weights ↔ D reads its own; D cannot write the table ↔ D's rebuild
lands. The two numbers do double duty — C's weight is exactly **−6**
(`hate` −2 × genre 3 ÷ 1 rated movie) and D's is **+9** (`love` 3 × genre 3 ÷ 1),
which pins §4.1's arithmetic *and*, because they differ, pins that the rebuild
is per-caller. Both assume movie `33333333` carries exactly one `movie_tags`
row; the test says so, because adding another would break them with a confusing
value rather than a clear failure.

The recommender's assertions compute the expected candidate set deliberately
rather than asserting "non-empty": phase 3's block deletes C's item, so the
group list holds only `55555555` by then.

The controls remain load-bearing, re-verified rather than assumed. Blanking
`request.jwt.claims` fails exactly 6 of A's controls, and D's entire block —
which is where every phase-4 control lives — aborts outright at
`join_group_by_code`. One assertion is labelled `weights:` rather than being an
access-control claim; it runs as `postgres`, the same way the existing
`constraint:` one does.

### Verification

1. `supabase db reset` → three migrations apply clean; `supabase test db` →
   **56/56**.
2. `pnpm typecheck`, `pnpm lint`, `pnpm build` — all clean. `/groups/[id]/night`
   builds as `ƒ`, server-rendered on demand.
3. **Hand-checked scoring**, not just plausible-looking numbers. A 3-candidate,
   3-member fixture computed by hand from §4.3 and compared to six decimals:
   two present → 1.0 / 0.234286 / 0.105; three present with a weightless member
   → 0.95 / 0.252857 / 0.12; that member alone → 0.5 across the board. All
   matched exactly. This is what pins the normalize, hype-override, min-term and
   cold-start branches simultaneously.
4. Real magic-link sessions against the local stack + Mailpit, every statement
   issued over PostgREST with that user's **real** access token, so all of it
   ran under RLS as a genuine `authenticated` user, over real TMDB titles:
   - `match_tags` deserializes as a real JS `Array`, not a string. This repo has
     two documented embed-shape surprises, so it was checked rather than assumed.
   - **A peer's rating moves the score**: Bob rated a comedy that was *not* on
     the group list, and Superbad went 0.0000 → 0.1500 on a call Alice made.
     (Rating Superbad itself would have marked it watched and dropped it from
     the pool — that tests §4.2's exclusion, not the cross-user read.)
   - Alice read 0 of Bob's status rows and 0 of his tag weights throughout.
5. **Live browser click-through** (Claude-in-Chrome): magic-link sign-in typed
   and clicked through Mailpit; Movie Night reached from the group header; top 3
   with §4.4 reasons rendering ("2 of 2 love Christopher Nolan", "Matches:
   Adventure, Science Fiction", "Nobody here has seen it"); Reroll exhausting
   the pool into the "That's everything" state and Start over clearing it;
   toggling a member off **changing the ranking** (The Prestige overtook
   Superbad once Bob's comedy taste left the room); the nobody-present empty
   state. No console errors.
6. The vote → rebuild loop driven by real clicks, not by calling the action:
   marking Superbad watched and clicking "Loved" on the group page took Alice's
   weights from 28 rows to 53, added Comedy 4.5 and Jonah Hill 3, and **halved
   Science Fiction from 9 to 4.5** as §4.1's denominator went from 1 rated movie
   to 2. Superbad then correctly vanished from her recommendations.
7. Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP, same route and
   reason as phases 0 and 3. `apply_migration` stamped `20260726154439` and the
   local file was renamed from `20260726144547` to match, so a later
   `supabase db push` does not re-run it.

### Supabase advisors: two new WARNs, both intentional

`get_advisors(security)` returns four
`authenticated_security_definer_function_executable` WARNs — phase 3's two, plus:

- **`rebuild_user_tag_weights`** must be callable by `authenticated`; it is what
  every vote triggers. Its **zero-argument** signature is what makes the RPC
  exposure harmless, the same reasoning phase 3 recorded for `is_group_member`:
  the only user it can rebuild is the caller.
- **`recommend_movies`** being callable is the entire feature. Its exposure is
  bounded by its two guards and by returning aggregates only.

`_rebuild_tag_weights` does **not** appear, which is the check that its REVOKE
worked: it is the one function here no client can reach.

---

## Phase 5 — `/api/ingest`, ingest tokens, Inbox resolution UI

Migration: `supabase/migrations/20260726185934_phase5_ingest.sql`.

The first phase with a route that is **not authenticated by a cookie**. An iOS
Shortcut has no session, so the token is the identity — which makes this also
the first phase where the server writes a *user's* rows rather than the catalog.
Both of those turn out to be where the real decisions are.

```
ingest_tokens   id, user_id, token_hash UNIQUE, label,
                created_at, last_used_at, revoked_at
ingest_inbox    id, user_id, raw_text, source, status,
                candidate_movie_ids uuid[], resolved_movie_id, created_at

lib/ingest/tokens.ts        mint / hashToken / verifyToken
lib/ingest/extract.ts       SPEC §5 step 3, pure
app/api/ingest/route.ts     POST { text, url?, token, source? }
app/inbox/                  page + resolve/reject actions
app/settings/               page + mint/revoke actions (§7 screen 11)
scripts/ingest-smoke.ts     `pnpm smoke:ingest`
```

**No functions this phase** — the first since 2 that needs none. The route runs
as `service_role`; the Inbox and Settings actions run as the authenticated user
under the policies below.

### The response order is not §5's, and the difference is data loss

§5 step 1 says "Verify token against `ingest_tokens`. **Return 200
immediately**," then step 2 inserts. Built the other way round:

```
verify token -> rate-limit -> INSERT pending (synchronously) -> 200
             -> steps 3-6 in after()
```

If the insert lived in `after()`, a failure would lose the share with a 200
already sent, and the user would have no way to know — they watched the share
sheet say it worked. The durable pending row is the entire basis for trusting
the Inbox; only *resolution* is safe to defer. `resolveInBackground` is wrapped
so a thrown resolution error leaves the row `pending`, which is exactly the
state the Inbox exists to drain.

**The cost of that ordering is a race, and it had to be closed.** The row is
listed in the Inbox from the moment the 200 lands, while the provider calls are
still running for seconds. The first version resolved unconditionally, so a user
could Dismiss a junk share and watch it appear on their list two seconds later —
§5's silent wrong add, arriving from the one direction the verification could
not see, because every `curl` was followed by a `sleep` before any UI touched
the row.

`resolveInBackground` now re-reads the status immediately before acting, and the
`update` additionally carries `.eq("status", "pending")`. Both are needed and
the order matters: the WHERE guard alone fires *after* `addToDefaultList`, so a
dismissal caught there would leave the user holding an item they had just
rejected. The re-read narrows the window from a provider round trip to a single
database one; if a dismissal still lands inside it, the row keeps its `rejected`
status and there is one stray list item — visible and removable, rather than a
status that lies.

Verified by overlapping rather than sequencing, with the control that makes it
mean something: the same TMDB-url payload dismissed mid-flight stays `rejected`
with `list_items` unchanged at 2, and **not** dismissed resolves to The Dark
Knight and takes the list to 3.

### What counts as "one high-confidence match"

§5 step 5 auto-adds on one; step 6 parks everything else. The bar:

- **A url names one film**, so both id kinds resolve directly. That is why §5
  puts them first, and why `Candidate` carries no numeric confidence field —
  `kind` already encodes it, and a second encoding of the same fact would drift.
- **Free text needs exactly one result whose title *is* the query.** Two films
  sharing a title — a remake, which is common — fails this and goes to the
  Inbox. Verified: `Dune` returns 2021, Part Two and 1984, and stays pending.
  Picking one would be the guess §5 forbids.

`candidate_movie_ids` holds internal `movies.id`, capped at 3 by the route.
`resolved_movie_id` is a uuid FK, so the picked candidate has to be cached
regardless; caching the top 3 up front moves 2 TMDB calls each — against phase
1a's measured ~20% ECONNRESET — out of the user's click path, and the Inbox
renders posters with **zero** provider calls. `Promise.allSettled`, so one bad
call costs one candidate rather than the row.

### The Inbox's third state is the common one

Shared Instagram and YouTube text links the *post*, not the film, so the url
branch misses and a Title Case run fires over a caption. An item with no
candidates renders its raw text and a link into `/search`.

The first cut prefilled that search with `raw_text.slice(0, 60)`. Driving it in
a browser showed why that is wrong: the box arrives full of
`this scene 😭 #cinema @a24 https://…`, searches to "No matches", and has to be
cleared before the user can type. It now passes the extractor's best `query`
candidate if there is one and **nothing at all** if there is not — a blank
autofocused box beats one you have to empty first. This is what `/search?q=`
and `SearchForm`'s `initialQuery` were added for.

### `service_role` bypassing RLS is not the same as reaching the table

The bug worth recording, because it was **silent in both directions**. Phase 0
revoked everything from `service_role` and granted back only the catalog tables
— correct at the time, since nothing server-side touched anything else. §5 step
5 ("add to default list") is the first thing that does.

An early run therefore resolved a share, marked the row `resolved`, and added
nothing to any list. postgrest reports permission failures in an `error` the
caller has to *look at*, and the first version of `addToDefaultList` looked at
neither. Two fixes, both needed:

- The migration grants `select on lists`, `insert on list_items` and
  `select on profiles` to `service_role` — scoped to exactly what the route
  does. No UPDATE or DELETE anywhere, so the endpoint cannot alter or remove
  anything a user already has.
- `addToDefaultList` now **throws** instead of returning quietly. The caller
  marks the row `resolved` only if it returns, so a share that could not be
  added stays `pending` rather than claiming a list it never reached.

Grants are a second gate, exactly as phase 0 documented. This is that lesson
arriving from the other side.

### `PUBLIC_PATHS` — one line, and the endpoint is dead without it

`lib/supabase/proxy.ts` redirects any cookie-less request to `/login`, and
`proxy.ts`'s matcher catches `/api/*`. The failure mode is quiet: a **307
preserves the POST method**, so a Shortcut would receive the login page as its
"response" and report success. Listed as `/api/ingest`, never `/api` — that
would make every future route public.

Verified as a pair, not a single check: `POST /api/ingest` with no token answers
`401` JSON, and `POST /groups` with no cookie still answers `307 -> /login`. The
second is what proves the first is the exemption rather than a dead proxy.

### `INGEST_TOKEN_PEPPER` throws at module load, and that is not defensive coding

With the variable unset, `createHmac` does not fail — it keys on the coerced
value. Every token would mint and verify happily under the same wrong key, with
no error anywhere, until the day the variable appears and every token in the
database becomes unverifiable at once. `requirePepper()` runs at import.

`token_hash` is a keyed hash and deliberately deterministic: verification is one
lookup through a unique index, and a per-row salt would make every ingest a full
scan. The token is 32 random bytes, so the pepper is not standing in for
password-hashing work — it is what makes a leaked dump useless without the
server's environment.

### Column-scoped grants make resolve/reject and revoke the *only* edits

RLS is row-level, so it cannot say "this column". The grants do:

| table | `authenticated` | why |
|---|---|---|
| `ingest_inbox` | `select`, `update (status, resolved_movie_id)` | **No INSERT grant, no INSERT policy.** Rows come from the one caller that verified a token — absence is the enforcement, as for phase 0's catalog, phase 3's `group_members`, phase 4's `user_tag_weights`. No DELETE: rejecting sets a status, because §5's point is that a share is never silently lost. |
| `ingest_tokens` | `select` (**excluding `token_hash`**), `insert`, `update (revoked_at)` | Without the column list the owner's own *browser* could read the hash out of their row. Relabelling and un-revoking are not features, and the grant is what keeps that true rather than the UI merely not offering them. |

Confirmed against the running stack as a real signed-in user, not reasoned
about: `select token_hash` returns `42501` even on the caller's own token.

`resolved_has_movie` is a check constraint, not a policy: a resolved row must
name the movie it resolved to, or the Inbox query and the badge count would
disagree about what "resolved" means.

### Departures and deferrals, stated rather than glossed

- **The rate limit is per user, not per token.** §11 says per token. §3 gives
  `ingest_inbox` no `token_id` column, and adding one purely to carry a limit is
  more schema than the constraint justifies at 4-6 users. A user with two tokens
  shares one budget — the safer direction to be wrong. 20/60s, measured: the
  18th request in a window returns 429.
- **The route writes `list_items` as `service_role`**, the third departure from
  phase 1b's "mutations run as the authenticated user". Forced — there is no
  session to run as. The `owner_user_id = token's user` scoping is therefore the
  only enforcement on that write, and `added_by` is the token's user for the
  same reason phase 3 pinned that column in the policy.
- **No tag-weight rebuild on resolution.** Adding to a list is not a rating;
  `rebuild_user_tag_weights` fires on `setRating`/`setWatched` only.
- **No Web Share Target, no iOS Shortcut** — §9 phase 6. The `source` column and
  a mintable token are the seams they plug into. Only `paste` is producible from
  the app today; `android_share` and `ios_shortcut` are accepted from the body.
- **No push on resolve** (§8, phase 11) and **no "none of these" logging**
  (phase 11 analytics).

### `extract.ts`, and the one bug the smoke script caught

Regex alternation is ordered, so `(?:of|the|and|a|an|in|on|at|…)` matches `a`
inside `at` and the Title Case run stops dead: "Everything Everywhere All at
Once" truncated to "Everything Everywhere All a". The `\b` after the connector
list is the fix. Worth stating because it is invisible to `typecheck`, `lint`
and `build`, and produces a *plausible-looking* wrong title rather than an error.

`scripts/ingest-smoke.ts` (`pnpm smoke:ingest`, `tsx`, the `smoke:tmdb`
precedent) pins all six of §5's patterns plus the two negatives — an Instagram
caption and pure boilerplate must both extract nothing. 10/10. No test runner
was added; that is a dependency, and CLAUDE.md says ask first.

### Tests

`supabase/tests/rls.test.sql`, now **73** pgTAP assertions (was 56).

Every phase-5 negative is paired with a positive control on the same table: B's
inbox unreadable ↔ A's own readable; B's tokens unreadable ↔ A's own readable;
A cannot INSERT into `ingest_inbox` ↔ A can resolve its own row; A cannot mint a
token for B ↔ A can mint its own; A cannot relabel ↔ A can revoke.

The controls were re-verified rather than assumed. Blanking
`request.jwt.claims` now fails **11** of 73 (was 6) — phase 0's six, plus five
phase-5 ones: A's two "sees exactly its own row" counts, "A's resolve actually
landed", "A can mint its own token", and the `resolved_has_movie` assertion,
which fails because an unreachable row means the UPDATE matches nothing and the
constraint never fires. Nothing passes for the wrong reason.

**The suite still requires a fresh database** — phase 0's fixtures hardcode
`tags` id 1 and assert exact `movies` counts, so run `supabase db reset` first
or get the confusing `Bad plan. You planned 73 tests but ran 0`.

### Verification

1. `supabase db reset` → four migrations clean; `supabase test db` → **73/73**,
   plus the blanked-claims counterfactual above.
2. `pnpm typecheck`, `pnpm lint`, `pnpm build` — clean. `pnpm smoke:ingest` 10/10.
3. `/api/ingest` reachability proved as a pair (401 vs the `/groups` 307 control).
4. **A token minted through the real Settings form in a browser**, then used
   over `curl` — the full path a Shortcut will take. Three payloads, all as
   designed: a TMDB url → `resolved`, Inception on the default list with
   `added_by` = the token's user; `Dune` → `pending` with 3 candidates; an
   Instagram caption → `pending` with none. A fourth with a junk token → 401.
   The one-shot reveal was checked by reloading `/settings`: the token is gone.
5. **Live browser click-through**: badge showing 2 on My List, both Inbox states
   rendering, picking a candidate resolving it (badge → 1, Dune onto My List),
   "Search for it" landing on a clean `/search`, Dismiss emptying the Inbox and
   clearing the badge. No console errors.
6. Cross-user, over PostgREST with a **real** second user's access token: Alice
   reads 0 of Bob's 3 inbox rows and 0 of his 1 token, is refused `token_hash`
   with `42501`, and is refused a forged `ingest_inbox` insert with `42501` —
   while a `postgres` control confirms those rows genuinely exist.
7. Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP, same route and
   reason as phases 0, 3 and 4. `apply_migration` stamped `20260726185934` and
   the local file was renamed from `20260726182239` to match, so a later
   `supabase db push` does not re-run it. Local and hosted then produced the
   same fingerprint across **all 8 categories** — columns, policies, table
   grants (column-level included), function bodies, function ACLs, constraints,
   indexes and RLS flags — `ee42bd209605ca71570243f0f9a72aec`, 503 objects each.
8. `get_advisors(security)` returns the **same four** WARNs as phase 4 and no
   new ones, which is the expected result: phase 5 adds no functions.

### Open, for later

- **The migration text stored on the remote matches the repo this time.** Phases
  0 and 4 both left the hosted `schema_migrations` row older than the local file
  because a revoke was applied separately afterwards. Nothing was applied
  out-of-band here, so a `supabase db pull` after linking would re-baseline this
  one faithfully. The phase 0 and phase 4 divergences are unchanged.
- **`ingest_inbox` grows without bound.** Resolved and rejected rows are never
  deleted, by design (§5: a share is never silently lost), and nothing prunes
  them. Harmless at 4-6 users; worth a retention decision before public launch,
  alongside §11's other pre-launch items.
- **The rate limit is still the only abuse control on this endpoint**, and it is
  per user. Phase 3's note about `join_group_by_code` having no limit at all
  still stands; both belong to the same pre-launch pass.
- **`INGEST_TOKEN_PEPPER` is deploy-blocking, not first-use-blocking.** The
  module-load throw means a Vercel build without the variable set fails while
  importing `/settings`, not on the first ingest. That is the intended trade —
  see above for what the alternative silently does — but it means the variable
  has to exist in Vercel *before* the next deploy. The hosted Supabase project
  already carries the tables; the deployed app does not yet have a pepper.
- **The Inbox nav link renders whenever the caller passes a count**, and only
  the badge is conditional on it being non-zero. The first version tied the link
  itself to `inboxCount > 0`, which made the Inbox appear and disappear from the
  nav as items arrived and were cleared — that reads as a bug, not a badge.

---

## Phase 6 — Android Web Share Target, iOS Shortcut

**No schema change.** `ingest_source` already enumerated `android_share` and
`ios_shortcut` (phase 5's migration), and `service_role` already held every
grant the new route needs. The third no-schema phase, after 1b and 2.

```
lib/ingest/resolve.ts         resolution engine, moved out of the ingest route
app/share/route.ts            the Android share target
public/manifest.webmanifest   share_target + the minimum install fields
public/icon-192.png, icon-512.png
components/shortcut-setup.tsx iOS steps + copy-the-endpoint button
```

Phase 5 named the seams: *"No Web Share Target, no iOS Shortcut — §9 phase 6.
The `source` column and a mintable token are what they plug into."* Both
platforms plug in, but by different mechanisms — Android's installed PWA
carries a cookie, so `/share` needs no token; iOS carries neither a PWA nor a
share target, so the payoff there is the instructions on `/settings`, not new
server code.

### `/api/ingest` and `/share` differ only in how they learn the user id

Everything after that — resolve a candidate, add to the default list, guard
against a dismiss racing the resolution — was identical between the two, so it
moved out to `lib/ingest/resolve.ts` as a pure relocation: same functions, same
comments, only the import graph changed. `resolveInBackground(db, rowId,
userId, text)` already took `userId` as a parameter, so no auth branch entered
the shared module. `pnpm smoke:ingest` stayed 10/10 across the move, and a real
token round trip against `/api/ingest` (TMDB url → resolved, `Dune`-style query
→ pending) confirmed no regression.

### `source` is hardcoded in `/share`, not read from the form

The route *is* the Android path. Accepting a client-supplied `source` would be
spoofable and would defeat the one thing the column exists for — §5:
*"Instrument every ingest with its source. That number decides whether the
Apple developer account is worth it."* Verified end to end against the local
stack: a real signed-in POST to `/share` landed a row with `source =
'android_share'`, resolved to Inception, added to that user's default list with
`added_by` set correctly.

### Every response is a 303, never a 307

A 307 preserves the POST method, which would make the browser re-POST to
`/inbox` — a GET-only page. This is the same trap phase 5 documented for the
proxy's own redirect, arriving here from a different direction. Verified:
`curl -i -X POST` against `/share`, both signed in and signed out, returns 303
in both cases, never 307.

### Two new entries in `PUBLIC_PATHS`, for two different reasons

- **`/manifest.webmanifest`** — browsers fetch a manifest without credentials
  by default. Left off this list, a signed-out visitor's first request for it
  would 307 to `/login`, the manifest would never parse, and the app would
  never be installable — silently, with nothing in the console naming why.
  Verified: `curl -i` with no cookie returns `200` and the JSON body, not a
  redirect.
- **`/share`** — same 307-preserves-POST hazard as `/api/ingest`. The route
  answers its own auth with a 303; the proxy's 307 would have to be avoided
  entirely for that to matter, so the path is exempted the same way
  `/api/ingest` was.

Listed one path at a time, never `/api` or a prefix — the precedent phase 5 set
for exactly this reason.

### The manifest's fields are the Chrome installability set, checked this
session, and no service worker is in it

Confirmed against Chrome's current documentation rather than assumed: Chrome
dropped the requirement for a fetch-handling service worker for install-from-menu
in M108 (mobile) / M112 (desktop). What Chrome does require — `name` or
`short_name`, a 192px **and** a 512px icon, `start_url`, and a `display` value
of `standalone`/`fullscreen`/`minimal-ui`/`window-controls-overlay`, over
HTTPS — is exactly what `public/manifest.webmanifest` carries. Nothing from
phase 7's offline shell got pulled forward as a result.

`share_target` is verbatim from SPEC §5, including `multipart/form-data` with
no `files` member — legal, if unusual; worth remembering as the first thing to
suspect if a manifest ever fails to parse. `start_url: "/"` redirects to
`/login` when signed out, which is intended, not a bug to fix in phase 7.

**Icons** are `VennMark`'s own geometry rendered to PNG, not new artwork: two
circles at 0.62× the icon size, offset 0.19×, `#f2545b` (circle-a) on the left
and `#4c6fff` (circle-b) at 75% opacity on the right, over the app's
`#15121c` background. Generated with a throwaway PIL script (not committed —
no new dependency, and phase 7's icon pass supersedes these), recorded here so
they're reproducible: 4× supersampled ellipses composited with `alpha_composite`
for the translucent overlap, then downsampled with Lanczos. Maskable variants,
monochrome icons, splash screens and `apple-touch-icon` are phase 7's row,
verbatim, and are not built here.

### The assumption this phase rests on, and could not verify

Supabase's auth cookies are `SameSite=Lax`, which withholds the cookie from
cross-site non-GET requests. The share-target launch is a POST *navigation*
triggered by the OS/browser share sheet, not by a page on this origin. If
Chrome classifies that navigation as cross-site, `getClaims()` in `/share`
would see nothing, every real share would 303 to `/login`, and the Android
half of this phase would silently not work — reading as "auth is broken," not
"share target misconfigured."

The reasoning points to same-site (the navigation targets this app's own
origin, user-agent-initiated, the same class as a typed URL or bookmark), but
neither the Web Share Target spec nor Chrome's own share-target docs say
anything about cookies — checked this session, and both instead describe a
service worker intercepting the POST, because their worked examples are file
sharing. **This could not be tested from here.** `curl --cookie` attaches
cookies unconditionally regardless of SameSite, and this environment has no
Android device and no OS share sheet to launch a real one. This is the phase's
primary unverified assumption.

**The fallback, decided in advance rather than as a mid-build stall:** if a
real Android share lands on `/login`, flip the manifest's `share_target.method`
to `"GET"` (params arrive as a query string), make `/share` a page instead of a
route handler, and render the shared text with one "Add to Venn" button wired
to a server action. A GET navigation carries Lax cookies; the button keeps the
write off the render, since a mutating GET would fire on prefetch or reload.
Cost: one extra tap and a stated departure from SPEC §5's literal "POST,
multipart" — the same kind of departure phase 5 recorded for reordering §5's
own steps 1 and 2. The insert, the `source` value, and `resolveInBackground`
are unchanged either way; only the transport would differ.

### One accepted departure from §5's own rule

A signed-out `/share` POST creates no row — confirmed as a paired control
alongside the signed-in case. That is a share vanishing without trace, which is
exactly what §5 says must never happen, and phase 5 built the
`rejected`-status-instead-of-DELETE design around that sentence. Accepted here
because there is no user to attribute an anonymous row to, and because an
installed PWA holds its session long enough that the window is small in
practice.

### Settings — iOS Shortcut steps, not a shortcut file

An unsigned `.shortcut` import requires the recipient to have already enabled
untrusted shortcuts in iOS settings — a worse first run than six manual steps —
so `components/shortcut-setup.tsx` renders the steps plus the one thing that
differs per deployment, the ingest endpoint. That URL is derived from the
request's `host` header via `headers()` in the server component rather than a
new env var: correct on localhost and on Vercel with nothing to keep in sync
between them, and no `.env.example` churn. Step 3's `source: ios_shortcut`
field is load-bearing, not decoration — omit it in a real Shortcut and every
ingest from it defaults to `paste`, and the count phase 5's Apple-developer
question depends on stays zero forever.

### Verification

1. `pnpm typecheck`, `pnpm lint` — clean. `pnpm build` — clean; `/share` builds
   as `ƒ`, server-rendered on demand. `pnpm smoke:ingest` — **10/10**, unchanged.
   This only covers `extract.ts` and confirms the import graph resolves; it
   exercises none of the moved resolution code. Step 5 below is the actual
   regression guard for the `resolve.ts` extraction.
2. `curl -i` on `/manifest.webmanifest` with no cookie → `200`, `Content-Type:
   application/manifest+json`, full JSON body — not a `307`. Both icon paths →
   `200`.
3. A real magic-link session against the local stack + Mailpit (the same
   round trip phases 1b–5 used). `curl -i -X POST -F` multipart to `/share`
   with that session's cookie → `303`, `Location: /inbox`; the row landed with
   `source = 'android_share'`, resolved to Inception, and the movie appeared in
   `list_items` on that user's default list with the correct `added_by`.
4. **Paired control**: the identical POST with no cookie → `303`, `Location:
   /login`, and no row created — confirming the exemption in `PUBLIC_PATHS` is
   scoped to the route's own auth answer, not a hole that lets anything through.
5. `/api/ingest` regression, same session, a real minted token (via
   `mintToken`/`hashToken` as `createIngestToken` would produce): a TMDB url with
   no `source` → defaulted to `paste`, resolved. A second call with
   `source: "ios_shortcut"` on an ambiguous title (`Parasite`, which has two
   films by that title) → `pending` with 3 candidates, `source` recorded
   correctly — proving the iOS path's payload shape end to end without an
   actual Shortcuts run.
6. No Claude-in-Chrome extension connected this session (recurring constraint
   in this repo). Fell back to headless `google-chrome`, same pattern as phases
   1b–3: a real magic-link sign-in via the actual `/auth/confirm` link from
   Mailpit, then `/settings` screenshotted showing both the existing token
   panel and the new "Send from your phone" section with the live endpoint,
   copy button, and numbered steps rendering correctly. (One purely cosmetic
   artifact: the headless environment's font substitutes the ⋮ and → glyphs in
   the Android install line with fallback glyphs — confirmed the source bytes
   are the correct `U+22EE`/`U+2192` characters; a real device renders them
   normally.)
7. **Not verified, and stated as such rather than implied**: a real Android
   home-screen install and a real share-sheet tap, and a real iPhone Shortcuts
   run. Neither can be driven from this environment. What (2)–(5) prove is that
   the endpoints behave correctly and the manifest is valid and reachable — not
   that the share sheet will carry a cookie, which is the SameSite question
   above.
8. Applied to nothing — no migration this phase, so nothing was applied to
   `vfkkpflenfpfrrygxmto`.

### Not in this phase

Install prompt UI, offline shell, maskable/monochrome icons, splash screens,
`apple-touch-icon` — phase 7's row, verbatim, and untouched here. Push
notification on resolve (§8) is phase 11. An iCloud share link for a prebuilt
Shortcut was considered and set aside: it requires the link to be created
outside this repo and the token would still need pasting by hand, so it saves
setup steps rather than eliminating them — the Settings section built here is
where it would drop in later if that changes.

---

## Phase 7 — PWA polish: icons, install prompt, offline shell

**No schema change.** Everything this phase touches is static assets, client
components and the proxy's exemption list.

```
public/icon-192.png, icon-512.png          regenerated, "any" purpose
public/icon-maskable-192.png, -512.png     new, "maskable" purpose
public/icon-monochrome.png                 new, "monochrome" purpose
public/apple-touch-icon.png                new, 180x180, opaque
public/manifest.webmanifest                purpose fields added
app/layout.tsx                             icons.apple, appleWebApp, viewport.themeColor
components/install-prompt.tsx              beforeinstallprompt + iOS fallback banner
components/register-service-worker.tsx     registers /sw.js
public/sw.js                               navigation-only offline fallback
app/offline/page.tsx                       static fallback shell
lib/supabase/proxy.ts                      PUBLIC_PATHS: + /sw.js, /offline
next.config.ts                             Cache-Control: no-cache on /sw.js
```

### Icons regenerated the same way phase 6 built them, this time meant to last

Phase 6's `icon-192`/`icon-512` were a stated placeholder ("phase 7's icon
pass supersedes these"), built by a throwaway PIL script never committed. This
phase used the same tool for the same reason — not a project dependency, just
a local generator — and regenerated all six files from `VennMark`'s own
geometry (`circle = size × 0.62`, vertical `offset = size × 0.19`) rather than
new artwork, so the icon and the in-app wordmark stay the same shape.

- **Maskable (`icon-maskable-192/512.png`).** The full-bleed mark (phase 6's
  original) already touches all four edges — `circle-b`'s right edge sits at
  `x = size`, `circle-a`'s left edge at `x = 0` — which is exactly what a
  maskable icon must *not* do, since an OS mask can crop up to ~20% from any
  edge. Fixed by rendering the mark at 0.7× into a virtual canvas and
  compositing it centered onto a full background-color square, landing the
  whole mark inside the ~80% safe zone with margin to spare.
- **Monochrome (`icon-monochrome.png`).** Android's themed-icon system reads
  only the alpha channel and retints with its own color, so the fill value in
  the file is irrelevant — rendered as a white silhouette on transparent,
  same 0.7× safe-zone scale as the maskable pair, single size (192) since
  nothing consumes a larger monochrome variant today.
- **`apple-touch-icon.png`.** iOS applies its own corner rounding at display
  time rather than reading a `purpose`, so this is the same 100%-scale
  full-bleed render as the plain icons, just at 180px with no alpha (iOS
  handles transparency poorly in this slot) — wired in via `Metadata.icons.apple`
  in `app/layout.tsx`, which Next resolves into the `<link rel="apple-touch-icon">`
  tag itself.
- **`app/favicon.ico`** is still Next's default icon, unrelated to Venn's
  branding. Named in phase 6's deferred list only as "icons," but not called
  out specifically — left alone this phase, confirmed with the user before
  building rather than folded in silently.

### Splash screens: the auto-generated kind, not the legacy PNG matrix

§9's phase 7 row names "splash screens." The traditional implementation is a
`<link rel="apple-touch-startup-image">` per device size/orientation — a
matrix that has to be regenerated per new device. Confirmed with the user
instead: iOS 16.4+ generates its own splash from the manifest's `icons`,
`background_color` and `name`, all of which this phase's manifest already
carries correctly (`#15121c` background, the same icon set). No new files for
this row; pre-16.4 devices fall back to a plain white flash, accepted rather
than built around.

### `appleWebApp` and `viewport.themeColor` exist because iOS mostly ignores the manifest

Android reads `display`/`theme_color`/`background_color` from
`manifest.webmanifest` directly. iOS Safari's PWA support predates broad
manifest adoption and still wants its own meta tags for the same information:
`apple-mobile-web-app-capable` (standalone launch) and
`apple-mobile-web-app-title` — both produced by Next's `Metadata.appleWebApp`
field, so no hand-written `<meta>` tags. `viewport.themeColor` is the
`Metadata`/`Viewport` split Next 16 requires — `themeColor` moved out of
`metadata` and into a separate `viewport` export some versions ago, and
putting it under `metadata` instead fails silently (no error, the tag just
never renders) rather than a build-time complaint.

### Install prompt: one banner, two mechanisms, because iOS has no event for this

`components/install-prompt.tsx` is `"use client"`, mounted globally from
`app/layout.tsx` rather than tucked into Settings — confirmed with the user
that "install prompt" should read as proactive, not something a user has to
go looking for.

- **Chrome/Android**: `beforeinstallprompt` fires only when the browser has
  already decided the site qualifies (valid manifest, HTTPS or localhost, a
  service worker with a fetch handler registered) — this is why the banner
  is wired to depend on `sw.js` already existing. `e.preventDefault()` on the
  event defers Chrome's own mini-infobar so this banner is the only prompt
  surface; clicking Install calls the saved event's `.prompt()`.
- **iOS Safari**: no such event exists on any iOS version. Detected instead
  by user-agent sniff plus `!isStandalone()`, and shown fixed text
  ("tap Share, then Add to Home Screen") rather than a button, since iOS
  gives no programmatic install call to wire up.
- **Dismissal** is a single `localStorage` flag, checked once on mount
  alongside `display-mode: standalone` / `navigator.standalone` (so an
  already-installed PWA never shows its own install banner to itself). No
  snooze schedule, no re-prompt-after-N-days — not asked for, and the
  simplest version already avoids nagging: one dismiss, gone for good.

**`react-hooks/set-state-in-effect` disabled on one line, not the rule.**
Whether the banner should render at all depends on `localStorage` and
`matchMedia`, neither of which exist during SSR — starting `dismissed = true`
(hidden) and flipping it once mounted is the standard fix for exactly this
class of client-only state, not the "syncing render with an effect"
anti-pattern the rule targets. Same precedent as `movie-card.tsx`'s existing
`eslint-disable` on `@next/next/no-img-element`: the rule's default
suggestion is the wrong fit here, stated inline rather than silenced globally.

### Offline shell caches exactly one thing, on purpose

`public/sw.js` is deliberately narrow: it intercepts **GET** navigation
requests only (`event.request.mode === "navigate" && event.request.method ===
"GET"`), tries the network, and on failure serves a single precached
`/offline`. It does **not** cache API responses, authenticated pages, or
anything from Supabase/TMDB.

**The GET half of that check isn't defensive — it fixes a real regression.**
`/share` (phase 6) launches as a **POST** navigation; phase 6's own DECISIONS
entry already noted Chrome's share-target docs describe "a service worker
intercepting the POST." A `mode === "navigate"` check alone would have caught
every Android share and routed it through this handler's `fetch()`/`.catch()`
instead of straight to the network — re-issuing a POST from inside a service
worker is its own risk, and a network hiccup would have served `/offline`
instead of reaching the ingest route, which is precisely what SPEC §5
forbids ("never guess... a silent wrong add is worse than a badge," and by
extension, a silently dropped share is worse still). Caught before merging,
not after a real share broke — the method check was added once the
overlap with phase 6's share-target mechanism was pointed out.

This app's entire security model is per-row RLS (phases 0, 3, 4, 5 all pin
this). A service worker cache is shared storage on the device, outside RLS's
reach entirely — caching any real page risks the browser replaying one
account's rendered HTML to whoever uses the device next. Scoping the cache to
one static, data-free, unauthenticated page sidesteps that risk completely
rather than managing it.

**Consequence, stated rather than glossed over:** only `/offline`'s HTML is
precached, not the CSS/JS chunks it references. Verified directly — stopping
the dev server and navigating served the offline page unstyled (default serif,
no dark background), because the browser also had no network to fetch the
Tailwind stylesheet chunk. Restarting the server and reloading rendered it
fully styled. In production this gap mostly closes itself: Next serves
`/_next/static/*` with long-lived immutable cache headers, so any device that
has loaded the app at least once while online almost certainly already has
those chunks in its ordinary HTTP cache. Precaching them properly would mean
a build-time asset manifest — a bundler plugin, i.e. a new dependency — which
is out of scope for what "offline shell" asked for here.

### `/sw.js` and `/offline` had to join `/manifest.webmanifest` in `PUBLIC_PATHS`

Same bug class phase 6 documented for the manifest, arriving twice more:

- The browser's own fetch of `/sw.js` carries no meaningful cookie context by
  the time it matters. Left off the exemption list, a signed-out visitor's
  first registration attempt would 307 to `/login`, and the browser would try
  to parse the login page's HTML as a script — registration fails silently,
  and offline support never activates for anyone who hasn't logged in yet.
- `/offline` is fetched once by the service worker's own `install` handler, in
  whatever auth state happens to be current at that moment. If that fetch
  redirects to `/login` instead of landing on the real page, the *login
  screen* gets precached under the `/offline` key — every subsequent offline
  navigation on that device would show a stale login form instead of the
  offline shell, and nothing would ever refresh it without a service worker
  update.

Verified as a pair against the running dev server, `curl -s -o /dev/null -w
"%{http_code}"`: `/manifest.webmanifest`, `/sw.js` and `/offline` all answer
`200` signed out; `/` still answers `307 → /login`, confirming the exemption
is scoped to these three paths and not a hole that swallows the redirect
generally.

### `Cache-Control: no-cache` on `/sw.js`, not on anything else

Without it, Vercel/the browser could hold onto a stale service worker
indefinitely, freezing every future deploy's offline behavior to whatever
`sw.js` a client fetched first. Scoped to exactly this one path in
`next.config.ts`'s `headers()` — nothing else in this phase needed a header
change.

### Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm build` — all clean. `/offline` builds
   as `○` (static, prerendered), the first fully static route since `/login`.
2. `curl` against the local dev server: `/manifest.webmanifest`, `/sw.js`,
   `/offline` → `200` signed out; `/` → `307 → /login` (the `PUBLIC_PATHS`
   pairing above). `/sw.js` response header confirmed `Cache-Control:
   no-cache`, `Content-Type: application/javascript`. All six icon files and
   the updated manifest JSON fetched and inspected directly.
3. **Live browser (Claude-in-Chrome), real interaction throughout:**
   - `/login` in Chrome: the install banner rendered as designed
     ("Install Venn for quicker access" + Install button). Clicking Install
     triggered Chrome's real native install-confirmation dialog — not
     simulated — which is itself a positive signal, since Chrome only offers
     that dialog to a site it has independently judged installable (valid
     manifest, HTTPS-or-localhost, a registered service worker with a fetch
     handler).
   - Dismiss (`×`) tested separately from Install, since the native dialog
     above blocks screenshot capture for its duration. Clicking dismiss, then
     reloading `/login`, confirmed the banner does not reappear — the
     `localStorage` flag persists across a real navigation, not just within
     one render.
   - Service worker state inspected directly in the page context:
     `navigator.serviceWorker.getRegistration()` →  registered at scope
     `http://localhost:3000/`; `navigator.serviceWorker.ready` → `active`;
     `caches.open("venn-offline-v1")` → `/offline` present.
   - **Offline fallback, forced for real rather than assumed:** the dev
     server was stopped outright (`curl` to it timed out, connection
     refused), then the browser was navigated to `/groups`. It rendered the
     offline shell's actual text ("You're offline. Reconnect to keep browsing
     your lists."), not Chrome's default dinosaur page — confirming the
     service worker's `fetch` handler catches a real network failure, not
     just a DevTools-simulated one. Unstyled, as the precaching-scope
     decision above predicts. Restarting the server and reloading `/offline`
     rendered it fully styled (dark background, `VennMark`, correct copy) —
     the online case works exactly as designed.
   - **Signed-out redirect re-confirmed with the service worker actually
     controlling the page**, not just over `curl`. Every navigation in the
     app now passes through this `sw.js`'s `fetch` handler, including the
     redirect response itself (navigation requests use `redirect: "manual"`,
     so a `307` arrives as an opaque-redirect response `respondWith` has to
     hand back correctly). With the SW active and no session, navigating to
     `/groups` in the browser landed on `/login`, not a blank tab or a
     swallowed redirect — the item 2 `curl` control and this one now cover
     the same guarantee from two different layers.
4. No migration this phase, so nothing was applied to `vfkkpflenfpfrrygxmto`.

### Not in this phase

`app/favicon.ico` (see above — asked, left alone). Push notifications, the
notification matrix, and any server-driven re-engagement are phase 11's row,
untouched here. No workbox/precache-manifest tooling was added — the
single-purpose hand-written `sw.js` above is deliberately the whole surface
area, not a first slice of a bigger caching system.

`appleWebApp.statusBarStyle` is `"default"`, which renders a light iOS status
bar over the app's near-black (`#15121c`) header — visible but not matched to
the theme. `"black-translucent"` would look better but needs
`viewport-fit=cover` plus manual safe-area-inset padding so the header content
doesn't sit under the notch/status bar; neither was asked for, so left as the
safe default rather than half-built.

---

## Auth: Google OAuth added (post-phase-7, revises Phase 0)

Not a numbered phase — a retrofit to Phase 0's auth deliverable, requested
directly. §1 and §7 of `docs/SPEC.md` now read "Google OAuth (primary),
magic link (secondary)"; the historical Phase 0 row in §9's build-order table
was left as `magic-link auth` since that's what actually shipped at the time.

**Files:** `app/auth/callback/route.ts` (new), `app/login/page.tsx`.

**No migration.** `handle_new_user()` (Phase 0) provisions `profiles`/`lists`
off an `auth.users` insert regardless of which provider created the row, so
Google sign-ins hit the same trigger and the same onboarding flow as
magic-link users. Nothing in the schema assumed email-only auth.

**Two auth flows, two routes.** Magic links use Supabase's token-hash flow
(`app/auth/confirm/route.ts`, unchanged). OAuth uses the PKCE code-exchange
flow instead — Supabase redirects back with a `?code=`, not a `token_hash` —
so it needed its own route rather than reusing `/auth/confirm`.
`app/auth/callback/route.ts` mirrors that file's shape: exchange the code,
redirect to `/`; on missing/invalid code, redirect to `/login?error=link_invalid`,
same as the magic-link failure path.

No `proxy.ts` change: `PUBLIC_PATHS` already lists `/auth` as a prefix, which
covers `/auth/callback` via the existing `startsWith` check.

**No new env vars for the hosted project** — its Google client secret is
configured in the Supabase dashboard (Authentication → Providers → Google),
not in this repo. **Local dev is different**: `supabase/config.toml` now has
an `[auth.external.google]` block (mirroring the existing disabled `apple`
one) so `pnpm exec supabase start` runs a Google-capable local GoTrue too.
That block's `client_id`/`secret` use `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)`
/ `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_SECRET)` — added to
`.env.example`, but note the Supabase CLI's `env()` only reads a root-level
`.env`, never `.env.local` (that file is Next.js-only), so these two need
their own `.env` locally. `auth.additional_redirect_urls` also gained
`http://localhost:3000/auth/callback` — that list requires *exact* URLs
(no wildcard support locally, unlike the hosted dashboard's `**` patterns),
so the bare origins already there wouldn't have matched the callback path.

**Client-side call, not a server action.** `signIn` (magic link) is a server
action because it only needs to call Supabase and report back "sent" or
"error" — no redirect leaves the app. `signInWithGoogle` runs in the browser
via `lib/supabase/client.ts`'s client instead: `signInWithOAuth` on that
client auto-navigates `window.location` to Google's consent screen, which a
server action can't do without an explicit `redirect()` round-trip for no
benefit here.

**Layout: always-visible secondary form, not a collapsed toggle.** Asked;
chose no extra state/click for email users over a marginally cleaner first
screen.

**Known pre-existing gap, not touched:** `/login?error=link_invalid` has
never been read by `app/login/page.tsx` — a failed magic-link confirm has
silently redirected to a blank login page since Phase 0. The new OAuth
callback inherits the same behavior for consistency. Out of scope here since
it predates this change; worth a follow-up.

**External configuration (not in this repo, done by the user):** Google
Cloud OAuth consent screen + Web application client ID, with **two**
authorized redirect URIs — the hosted project's
`https://vfkkpflenfpfrrygxmto.supabase.co/auth/v1/callback` and the local
`http://127.0.0.1:54321/auth/v1/callback` (Google permits `http` for
loopback addresses); Supabase Authentication → Providers → Google enabled
with that client's ID/secret; Supabase Authentication → URL Configuration →
Redirect URLs allow-listing `http://localhost:3000/**` and
`https://venn-roan.vercel.app/**`.

---

## Visual identity: palette, type, and a precise VennMark (post-phase-7)

Not a numbered phase — a full design pass on the whole app's visual system,
requested directly ahead of an expected scale-up (real user growth, a brand
worth defending). Scope, per the user's own call: the token system (color,
type) plus two hand-finished flagship screens (`/login`, home/My List) —
every other screen inherits color and type automatically through the same
CSS custom properties and Tailwind theme they already referenced, and mostly
needed zero code changes to pick up the new look (confirmed live on
`/search`, which was never touched — its gradient input border and wordmark
updated for free).

**Files:** `app/globals.css`, `app/layout.tsx`, `components/venn-mark.tsx`,
`components/app-header.tsx`, `components/vote-control.tsx`,
`app/login/page.tsx`, `app/page.tsx`, `public/manifest.webmanifest`, and all
six PWA icon/apple-touch-icon PNGs (regenerated).

### Why the old palette had to go

The shipped palette (circle-a `#f2545b`, circle-b `#4c6fff`, overlap
`#9f61ad` on a `#15121c` near-black ground) wasn't wrong on its own terms —
the RGB-midpoint-as-overlap idea was already good — but at the scale the
user is building for, it reads as the single most common "modern app" look
right now: near-black background, one violet/purple accent. Discord,
Linear, and a large share of Vercel-ecosystem and AI-adjacent products
converge on close to that exact orchid-violet. Renaming it wouldn't fix
that — mixing any warm (reddish) hue with any cool (bluish) hue via literal
RGB averaging lands in purple/magenta territory almost by mathematical
necessity, so keeping the midpoint mechanic while chasing "not purple" is a
contradiction. The fix had to be which two hues get averaged, not the
averaging itself.

### New palette

Reel Rust `#D43F26` (circle-a) × Projector Blue `#2461A8` (circle-b) →
Velvet Wine `#7C5067` (`overlap`, still the literal RGB midpoint — mechanic
unchanged). Grounded in film's own materials rather than tech-palette
space: aged celluloid rust, projector-glow blue, and their overlap landing
on velvet-cinema-seat wine. Ground shifted from violet-tinted near-black
(`#15121c`) to warm near-black Blackout `#191411` (a warmed HSL ramp derived
from it: surface `#271F1A`, surface-strong `#342A24`), so the identity reads
as "dark room" rather than "dark SaaS."

**Dark is now the default (`:root`), light is the media-query override** —
flipped from the previous structure. Per the user: dark is the actual brand
(App Store listing, pitch deck), matching how the product is actually used
(deciding what to watch, at night, on a phone). Light mode is unchanged in
its own values (`#faf7f3` cream, etc.) and still fully supported, just no
longer the code's implicit default.

**Contrast was computed, not eyeballed**, because the first-draft hexes
failed two real checks:
- `circle-a` against white button text was 4.11:1 (fails WCAG AA's 4.5:1
  for normal text) at the original `#E1462B` — darkened to `#D43F26`
  (4.63:1) before it was used anywhere.
- The pure Velvet Wine midpoint against the new Blackout ground is only
  2.78:1 — fine for a filled button (text sits on the fill, not the page
  background, and that pairing is 6.56:1), but the *old* palette's focus
  ring (`overlap` directly on `bg`) was 4.22:1, so reusing pure wine for
  `:focus-visible`/`::selection` would have been a real regression on
  keyboard-focus visibility. Added `--ring: #8F5C76` — wine lightened in
  HSL just enough to clear 3:1 (3.44:1) — used only for those two rules.
  `--overlap` itself stays the true, unlightened midpoint everywhere else.

### VennMark: the lens is now real, not simulated

The old mark faked its overlap region with plain CSS opacity (circle-b at
75% laid over circle-a) — whatever color appeared where they crossed was
alpha-composited by the browser, not the actual `--overlap` value anywhere
in the markup. At the scale this brand is meant to reach, two overlapping
circles alone is one of the most common shorthands for "compatibility/match"
(dating apps, insurance comparisons, data-viz decks) — the thing that makes
it ownable here is that the intersection is now *precisely* the computed
midpoint, not applied to the mark, so the logo is a small, checkable claim:
"these two colors, mixed, produce exactly this third one."

Technique: a third circle, identically positioned/sized to circle-a,
clipped with `clip-path: circle(r at cx cy)` using circle-b's geometry
converted into the third circle's own local coordinate space. The visible
region of "an element shaped like circle-a" ∩ "a clip region shaped like
circle-b" is exactly circle-a ∩ circle-b — CSS does the set intersection,
not an approximation. Verified at all four in-app sizes (22/30/40/96px) via
an isolated static-HTML test before touching the component, since the lens
gets genuinely thin at icon scale (~8px wide at 30px) and needed confirming
it wasn't just anti-aliasing away to nothing.

Same technique reimplemented in Pillow (`ImageChops.multiply` of two 0/255
circle masks, since `Image.composite` against one circle's mask alone was
tried first and silently wiped out that circle's own non-overlapping region
— caught by inspecting the rendered PNG before regenerating all sizes) for
the regenerated PWA icons, so the app icon and the in-app mark are the same
claim rendered by two different engines.

### Type

Geist Sans/Mono (Next.js's own defaults, zero personality) replaced
entirely: **Fraunces** (variable, `opsz`/`SOFT`/`WONK` axes loaded) for the
wordmark and empty-state headlines only — dialed toward its idiosyncratic
soft-serif character, never used for body text. **Karla** for all UI text.
**Space Mono** replacing Geist Mono for the metadata/eyebrow pattern that
already existed (`YOUR LIST`, years, counts) — same role, more ticket-stub
character.

### Also changed: circle-b gets a real job

`circle-b` had zero functional meaning before this — decoration only (the
mark, the card hover-glow). `circle-a` already meant something: SPEC §4.1's
`hate` is the only *negative* rating weight, and `VoteControl` gave it
circle-a instead of the shared `overlap` fill every other value used.
`circle-b` now takes the top of each scale — `love` and `superhyped`, SPEC
§4.1's +3 — not because the spec singles those out the way it does `hate`
(it doesn't; `love` is just the top of a linear positive range, not
qualitatively different from `like`), but as a design-system choice: circle-a
and circle-b become the two poles the rating system actually swings between,
with `overlap` as the shared middle ground. Documented as such in
`vote-control.tsx` so a future reader doesn't mistake it for a SPEC-mandated
asymmetry.

### Not in this pass

Every screen besides `/login` and home was left untouched at the file
level — Search, Groups, Movie Night, Settings, Inbox, Movie Detail all
inherit the new palette/type through the same CSS custom properties and
Tailwind theme mapping they already used, with no hand-finishing. Confirmed
live on `/search`, which picked up the new wordmark and a rust→petrol
gradient input border it already had, just recolored — not something built
in this pass.

---

## Vibrant/bold/immersive: reframed around real poster art, not new UI color

Requested directly, off a set of 2026 design-trend articles (Figma's trend
roundup, a mobile UX trends search). Most of what's actually trending right
now — gamification, neumorphism, 3D/AR, neo-brutalism, vibrant "dopamine"
UI chrome — was rejected outright: gamification contradicts SPEC §8's
"rating is prompted, never blocking... mandatory modals get apps deleted,"
neumorphism regresses the contrast work already done, and generic vibrant
color chrome would have undone the whole rust/petrol/wine pass by chasing
the *next* crowded trend instead of stepping outside the cycle.

The compromise that survived scrutiny: real movie poster art is *already*
vibrant, maximalist, marketing-designed to pop — the app doesn't need
neon-colored buttons to feel immersive if it lets that material carry the
feeling instead. So "vibrant" and "immersive" landed as one move, not two.

**Files:** `app/globals.css` (new `--vivid-a`/`--vivid-b` tokens),
`components/night-pick-hero.tsx` (new), `app/groups/[id]/night/page.tsx`,
`app/page.tsx`.

**`--vivid-a` (`#F9482A`) / `--vivid-b` (`#0D72E8`)**: circle-a/circle-b with
saturation and lightness boosted in HSL space. Explicitly scoped to
backdrops/glows/scrims only, never persistent chrome and never small text —
`vivid-a` is 3.51:1 against white, below AA's 4.5:1 for text, which is fine
for a blurred ambient glow no one reads but would be a real regression as a
button fill. Documented as a boundary directly in `globals.css` so it isn't
reached for casually later.

**`NightPickHero`** replaces the Top-3 grid's uniform treatment for pick #1
only (SPEC §7 screen 6's reveal moment) — a full-bleed blurred, scaled
backdrop of the pick's own poster (`blur-2xl`, `scale-110`, TMDB `w780`),
a `bg`-to-transparent scrim for legibility, the sharp poster in the
foreground, and an oversized `font-display` title. Picks #2/#3 stay as
plain `MovieCard`s below, unchanged, so the hierarchy — one winner,
two runners-up — is visual, not just numbered badges. No-poster case falls
back to a `--vivid-a`/`--vivid-b` radial-gradient glow rather than breaking
the layout.

**Home's empty-state hero** got the same ambient-glow treatment behind the
`VennMark` (ambient, ~40% opacity, heavily blurred, ` -z-10` so it never
competes with the mark) and a much larger `Nothing here yet` (`text-5xl`,
up from `text-3xl`) — the "oversized headline" move, using the same
Fraunces already established rather than a second display face.

### Not in this pass

Everything else on the trend lists — glassmorphism, gesture nav, 3D/AR,
voice UI, gamification, asymmetric layouts, a second "poster marquee" 
display typeface — deliberately skipped. Reasoning is in the chat, not
repeated in full here: most either contradict SPEC's own stated product
philosophy or would have meant chasing whichever look is currently
converged-on, which is the same failure mode the rust/petrol/wine palette
was chosen specifically to avoid.

---

## Design reset — "Neon Marquee"

**The two entries above are superseded.** Neither shipped: both were still
uncommitted when the user read them back and called the result "boilerplate AI
generated design," and asked for a reset from scratch with a vibrant palette,
bold typography and immersive elements. The prior work was stashed
(`pre-reset design pass (rust/wine/Fraunces)`) rather than discarded, and only
this document was recovered from it — so the reasoning survives even though the
code does not. They are left in place because the *diagnosis* of why they read
as generic is the most useful part of this entry.

The verdict was correct and the cause is nameable. That system was muted
rust/wine on a tinted near-black with one soft accent, Fraunces as the
personality serif, `rounded-full` on 53 elements, and a two-tier type scale
(`text-sm` body, 10–11px labels) with nothing in between. Every one of those is
a default a language model reaches for first. The second pass also explicitly
*rejected* vibrant color, bold display type and immersive treatment as "chasing
trends" — which is exactly what was being asked for.

Direction, mark treatment and scope were chosen by the user from three rendered
options, not proposed as a single take.

### The palette is light, because the mark is light

```
--ink        #000000    true black, not a tinted near-black
--surface    #0B0B0D    --surface-2  #16161A
--fg         #FFFFFF    --fg-dim     #8E8E99   --fg-faint  #7F7F8A
--beam-a     #FF2D6F    --beam-b     #00E5FF   --marquee   #FFE500
--on-beam    #000000
```

The overlap is **not a token**. Both circles composite with
`mix-blend-mode: plus-lighter`, which adds channel-wise and clamps:

```
#FF2D6F + #00E5FF = (255, 274->255, 366->255) = #FFFFFF
```

Pure white — the blown-out center of two beams landing on the same spot. The
previous mark faked its intersection with a `clip-path` and a hand-picked third
hex; this one contains no third color at all. Verified by rendering it headless
at 22/30/40/96px before anything was built on top: the intersection samples
`(255,255,255)` at every size.

The 0.55 circle-to-box ratio was measured, not picked — rendered against 0.52,
0.58, 0.61 and 0.64. Above ~0.58 the white lens swallows both beams and the
mark reads as one blob; below ~0.52 the lens vanishes at 22px.

Two constraints follow and both are commented at the call sites: the wrapper
must `isolate` or the blend leaks onto the page, and the mark must never sit on
a bright fill (additive light on a bright backdrop clips to white everywhere).
`AddToListButton`'s success badge is `bg-ink` for precisely that reason.

### Contrast was computed, and it caught three real failures

Scripted over every pair the app actually renders, not eyeballed:

| on `#000000` | | on `#16161A` (the tightest surface) | |
|---|---|---|---|
| `--fg` | 21.00 | `--fg` | 18.04 |
| `--fg-dim` | 6.48 | `--fg-dim` | 5.57 |
| `--fg-faint` | 5.31 | `--fg-faint` | 4.56 |
| `--beam-a` | 5.86 | | |
| `--beam-b` | 13.65 | | |
| `--marquee` | 16.46 | | |

Two rules fall out, and both are load-bearing:

1. Every accent clears 4.5:1 on the ground, so an accent may carry meaning as
   text rather than being restricted to decoration.
2. **Text on an accent fill is always black.** White on `--beam-a` is 3.59:1
   and fails AA; black is 5.86:1. `--on-beam` makes that a token decision
   instead of a per-component judgement call.

Three things the arithmetic caught that inspection would not have:

- `--fg-faint` started at `#7A7A85`, which measures 4.25:1 on `--surface-2` —
  fine on the ground, a real failure in the one place the app nests text on a
  lifted panel. Solved upward to `#7F7F8A`.
- **The page grain was rendering as literally nothing.** It was specified as
  `soft-light`, which by definition leaves pure black untouched, and the ground
  is `#000`. Sampling the painted pixels returned `(0,0,0)` across an empty
  band. Changed to `screen` at 0.1 — now 595 distinct values in that band, and
  because the layer sits *under* all content (layout puts children in a `z-1`
  context) it can blend additively without ever compositing against text.
  Re-measured against the brightest grain pixel: white 18.37:1, `--fg-dim`
  5.67:1, `--fg-faint` 4.64:1. All still AA.
- **The night hero's supporting text failed over real poster art.** Measured
  off the rendered page against a text-free strip of the blurred backdrop,
  `--fg-dim` came out 4.36:1. Poster art is arbitrary, so no scrim setting can
  be trusted to hold a muted tone; the year and reason lines are white now, and
  hierarchy comes from the 96px title instead of from dimming.

`--ring` is deleted. The previous palette needed a lightened-accent token
because its muted midpoint measured 2.78:1 as a focus outline. `--marquee` at
16.46:1 is a better ring than any dedicated token and is on-concept.

**Light mode is dropped**, `color-scheme: dark` on `:root`. Every figure above
is computed against `#000`, and a white-ground variant of "projector light in a
dark room" is a different product, not a theme. Flagged to the user before
implementation rather than discovered afterward.

### Type: two families, and the second one does three jobs

**Anton** (static 400, display only) and **Archivo** (variable, `wdth` 62–125 ×
`wght` 100–900). Both confirmed against Next 16.2.12's own `font-data.json`
before the plan was written, so this cost **zero new dependencies**.

Archivo's width axis is what replaces the 28 `font-mono` uses: the uppercase
eyebrow is `wdth 118 / wght 600 / 0.18em`, owned by a single `.t-label` rule.
No monospace webfont loads at all. `--font-mono` is the *system* stack and is
reserved for the three places the text is genuinely machine-read — invite code,
ingest token, endpoint URL — where character disambiguation actually matters.

Real scale jumps, since bold typography means hierarchy and not just weight:
display `clamp(40px,12vw,104px)` at `line-height .82`, section 24–32px, body
15px, label 11px. Display type is expected to crop off the frame on hero
screens; the sections clip it deliberately.

### Radius: near-square, with one rule for the exception

`--radius-card: 3px`, `--radius-ctl: 2px`. This is the single largest visual
break from the old look. The exception is stated as a rule so it reads as a
system rather than an inconsistency: **circles are reserved for the mark and
for things that stand for people.** After the rebuild the only surviving
`rounded-full` uses are the mark, the spinner, the present-picker chips and the
group member pills — which is exactly that rule and nothing else.

### Immersive, without a dependency

- **Poster beam** — the same hotlinked `image.tmdb.org` URL painted twice: the
  sharp `<img>`, plus an `aria-hidden` copy blurred and over-saturated behind
  it. One request, two paints. Still a plain `<img>`; `next/image` would proxy
  the bytes through Vercel, which CLAUDE.md forbids. Off by default in grids —
  twenty simultaneous glows read as fog — and lit on hover.
- **Film grain** in two layers for one reason, legibility: `.grain-page` under
  all content, `.grain-art` over poster artwork only, where there is no text to
  degrade. The tile is a 140×140 `feTurbulence` data URI repeated, not one
  viewport-sized turbulence rect, which is expensive on phones.
- **Letterbox** on the night reveal, `/login` and `/offline`.
- **Marquee ticker** of who is present. It pads its sequence to at least 8
  entries before duplicating, because with one member present the track was
  narrower than the viewport and `-50%` dragged visible empty space across the
  screen.

### A primitives layer, because nine hand-built screens otherwise drift

`ui/screen` (replaced 7 verbatim page shells), `ui/button` (6 copies of the
primary button, plus the shared overlay-button class), `ui/panel`, `ui/label`
(25 label sites), `ui/input`, `ui/spinner` (3 verbatim copies), and
`components/poster`. Each replaces five or more existing copies, so this is
deduplication rather than speculative abstraction.

`ui/input` deliberately carries **no `flex-1`**. It did at first, and in
`/login`'s column-direction form that sets flex-basis on the vertical axis and
collapsed the field to a sliver — visible immediately in the browser pass and
invisible to `typecheck`, `lint` and `build`. Row layouts opt back in.

### `VoteControl`'s scale is the mark, unrolled

`--beam-a` at the low end, `--beam-b` at the top, and the middle value **white**
— which is what those two beams make where they overlap. The control and the
logo became the same statement. `ListFilter`'s value chips follow the same
mapping; its three structural chips light marquee, because they are navigation
rather than a value.

This is a design-system choice, not a SPEC-mandated asymmetry, and is commented
as such: §4.1 singles out `hate` as the only negative tag weight, but `love` is
just the top of a linear positive range.

### Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm build` — clean.
2. Contrast scripted over every rendered pair; the three failures above were
   found this way and fixed before shipping.
3. `plus-lighter` confirmed by headless render at all four in-app sizes before
   anything depended on it.
4. **All nine screens driven in a real browser at 390×844**, signed in through
   a genuine magic-link round trip against the local stack + Mailpit, with the
   catalog seeded from live TMDB (13 films, real poster art) and every vote
   state represented. Desktop at 1280 as a second pass. Four layout bugs were
   found only here: the nav clipped "Settings" off the viewport, "Very hyped"
   wrapped to an uneven height, the ticker dragged empty space, and the login
   field collapse above.
5. `prefers-reduced-motion` — ticker halted, nothing left mid-animation.
6. PWA icons regenerated with the same additive math in Pillow
   (`min(a+b, 255)` per channel — *not* `ImageChops.multiply`, which darkens
   the intersection instead of blowing it out), then inspected as rendered PNGs
   before shipping: intersection samples `(255,255,255)` at every size,
   maskables sit inside the 80% safe zone, monochrome is a white silhouette on
   transparent. Manifest and `themeColor` are `#000000`.

### Not in this pass

- **The platform layer.** The app still has **zero** `loading.tsx`, zero
  `<Suspense>`, zero `error.tsx`, zero `not-found.tsx` and no skeletons. Every
  page is an async server component that blocks on Supabase, so every filter
  chip, present chip and reroll is a dead tap until the server answers. This is
  the largest remaining UX gap and the obvious next pass; the user scoped this
  one to the visual rebuild.
- **Live-readout circles** — one circle per person present, the mark as a
  consensus meter. Chosen by the user as a later step, by name.
- **View Transitions** — `experimental.viewTransition` is flagged "not
  recommended for production" in Next 16.2.12's own docs.
- **Scroll-driven animation** (`animation-timeline: view()`) — support was too
  unsettled to pin during planning; the hardcoded `animationDelay` stagger
  stays for now.
- **JustWatch attribution UI** — still owed from phase 1a, but no
  watch-provider data reaches a screen yet, so nothing is out of compliance.

---

## The platform layer — loading, errors, and the dead taps

Closes the gap the design reset left open by name. Before this the app had
**zero** `loading.tsx`, zero `<Suspense>`, zero `error.tsx`, zero
`not-found.tsx` and no skeletons: every page was an async server component that
blocked on Supabase, and `notFound()` fell through to Next's stock 404.

### The loader is the mark, hunting

There is no generic spinner in this app. `VennMark` gained a `mode` prop —
`still` (the wordmark), `arrive` (the one-shot beam sweep, unchanged) and
`scan`, which drives the two beams back and forth forever so the white lens
swells and closes. Two things trying to find their overlap is a more honest
description of what Venn is doing while you wait than a rotating arc, and it
reuses the same geometry and the same `plus-lighter` blend rather than
introducing a second visual idea.

`mode` replaced the old `animated` boolean rather than sitting beside it: two
mutually exclusive booleans is a worse API than one enum, and there were only
three call sites.

`VennMark` is `aria-hidden`, so `VennLoader` carries the semantics —
`role="status"` + `aria-live="polite"`, which announces once on appearance and
then stays quiet. Verified during a live navigation: exactly one `role=status`
node on screen, not one per skeleton tile.

Under `prefers-reduced-motion` the beams hold still and the whole mark breathes
instead — an opacity cycle, no positional movement.

### `loading.tsx` was never going to fix the filter chips

This is the part worth writing down, because it is counter-intuitive and it is
the actual reason the taps felt dead.

`loading.tsx` fires when a **route segment** is newly rendered. The filter
chips, the present picker, reroll and start-over all navigate to the *same*
route with different searchParams, and Next runs `<Link>` navigations inside a
React transition — whose entire purpose is that the previous UI stays on screen
instead of falling back to a boundary. So the route-level boundary never
engages, and adding one changes nothing for exactly the interactions that were
worst.

The fix is `useLinkStatus()` (exported from `next/link`; confirmed present in
Next 16.2.12 before it was designed around). It reports the pending state of
the enclosing `<Link>` and only works in a client component rendered as its
descendant, so `components/ui/link-pending.tsx` is a small client component
dropped inside each chip. It covers **the control you actually tapped**, which
also answers "which one did I press" — something a page-level loader
structurally cannot express.

Verified over CDP rather than reasoned about: with a temporary 3s server delay,
a real DOM click on the "Watched" chip, screenshotted 900ms later. The tapped
chip carries the overlay, the other two are untouched, and the previous page
content is still rendered behind it — which is the transition behaviour above,
observed directly.

Every control that needed it is `relative` now: `chipBase` in both
`list-filter` and `present-picker`, plus `buttonClass`'s base and
`navLinkClass`.

### Skeletons hold shape; they do not perform

One shared `ScreenLoading` with `grid` / `rows` / `plain` variants, mirroring
each screen's real rhythm (header row, display heading, content) so the swap is
a fill-in rather than a relayout. Tiles are dumb blocks on `--surface-2`.

Activity is signalled **once**, by the loader in the header — not by twenty
independently animating tiles. They breathe (a slow opacity cycle) rather than
shimmer, because a sweeping highlight gradient is the house style of every
dashboard template and this system has already paid to not look like that.

### Errors

- `app/error.tsx` — client boundary with `reset()`. Logs `error.digest`, which
  in production is the only handle on the server stack (the message itself is
  redacted before it reaches the client), and surfaces it so a user can quote
  it.
- `app/not-found.tsx` — **copy deliberately vague.** Both `/groups/[id]` and
  `/groups/[id]/night` call `notFound()` for non-members precisely so the
  group's existence is never confirmed, so this page has to read identically
  whether the group is real or not. "This page doesn't exist, or it isn't yours
  to see" is doing security work, not tone work.
- `app/global-error.tsx` — replaces the root layout, so `globals.css` and both
  fonts never load. Everything in it is inline for that reason; a class name
  would resolve to nothing. The mark is hand-rolled from two spans.

### Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm build` — clean.
2. Loader cycle rendered headless as a filmstrip across five phases: apart,
   converging, lens fully open, separating, apart.
3. Both skeleton variants rendered in the running app. (First attempt 404'd:
   the preview route was under `app/__loaderpreview/`, and App Router treats
   `_`-prefixed folders as private and excludes them from routing. That
   accident did confirm `not-found.tsx` renders correctly.)
4. The pending overlay driven by a real click over CDP, as described above.
5. The temporary 3s delay used for (4) was removed and its absence confirmed by
   diff before commit.

### Still not in this pass

- **Streaming with `<Suspense>`.** Each page still awaits all of its queries
  before rendering anything; `loading.tsx` covers the whole screen rather than
  letting the header paint while the grid resolves. Worth doing on `/` and the
  group page, where the poster query dominates.
- **Optimistic UI** on the vote controls. `useTransition` disables them today;
  `useOptimistic` would let a vote land instantly and roll back on failure.
- **View Transitions** — still flagged not-for-production by Next.

---

## Mark colors: magenta/cyan → orange/azure ("Cinema")

The user flagged that `--beam-a`/`--beam-b` (magenta `#FF2D6F`, cyan `#00E5FF`)
read as visually adjacent to another app's mark before they read as Venn's —
two overlapping circles is already a common shorthand (compatibility apps,
insurance comparisons, data-viz decks), so the specific hue pair was carrying
more of the risk than the shape.

Replaced with orange `#FF5A1F` / azure `#00C2FF` ("Cinema"). Chosen over two
other computed candidates — gold/blue (`#FFB400`/`#0080FF`, rejected: too close
to `--marquee`'s existing yellow, so the mark and the primary CTA would compete
for "the important color") and violet/chartreuse (`#9B3FFF`/`#C8FF00`,
rejected: boldest option but chartreuse skews toward a 90s-neon/toxic
association, and violet cleared AA at only 4.55:1, the thinnest margin of the
three) — presented to the user as a live HTML comparison (actual
`mix-blend-mode: plus-lighter`, not swatches) before picking.

Orange/azure is not an arbitrary substitution: it's the actual complementary
color grade used on theatrical posters and DCPs (skin tones pushed warm,
shadows pushed teal), so for a movie-night app it's a convention already in the
subject's own world rather than a borrowed palette.

**The additive-light proof still holds, with new numbers:**

```
#FF5A1F + #00C2FF = (255, 90+194->255, 31+255->255) = #FFFFFF
```

Verified two ways: sampled the actual rendered pixel at the mark's overlap
(white, exactly), and sampled the regenerated PWA icons' center pixel the same
way.

**Contrast, recomputed, not assumed to transfer:**

```
on #000000      beam-a 6.73   beam-b 10.16
on #16161A      beam-a 5.79   beam-b 8.73
black on beam-a 6.73   (white on beam-a 3.12 — still fails AA, --on-beam stays black)
```

Every figure still clears 4.5:1; the "text on a fill is always black" rule from
the original palette needed no change, just new numbers behind it.

**Files touched:** `app/globals.css` (tokens + the file-header proof comment),
`components/venn-mark.tsx` (the proof comment only — the component reads the
CSS custom properties, so no logic changed), `app/global-error.tsx` (the two
hardcoded hexes — this file can't reach the CSS tokens, since it replaces the
root layout on the same failure path that would take `globals.css` down with
it), and all six PWA icon PNGs, regenerated from the same geometry phase 7
established (`circle = size × 0.62`, `offset = size × 0.19`, maskable variants
at 0.7× scale centered in the full canvas) with the new beam colors baked in.
`icon-monochrome.png` was left untouched — Android's themed-icon system reads
only its alpha channel, so the fill color in that file was never load-bearing.

### Verification

1. `pnpm typecheck`, `pnpm lint` — clean.
2. Overlap pixel sampled at (255, 255, 255) in both the live-rendered mark and
   the regenerated icons, not eyeballed.
3. All contrast pairs recomputed via script, not carried over from the old
   palette on the assumption that "it's still an accent color, should be fine."
4. Mark viewed live in the running app at header scale (26px) — the white lens
   stays legible at the smallest in-app size, not just at icon scale.

## Mobile audit: VoteControl overflow, search hang, safe-area, tap targets

The phase-7/Neon-Marquee verification pass (see above, "all nine screens driven
in a real browser at 390×844") checked exactly one viewport. A follow-up pass
at smaller widths found the app scrolling sideways on every phone narrower than
388px, plus a second, unrelated window at 768-775px (iPad portrait) — same
root cause, different trigger.

**`VoteControl`'s label size was fixed to fit one viewport, not a range.**
`components/vote-control.tsx`'s three-button row is `flex-1` with the default
`min-width: auto`, so it has a hard intrinsic floor set by its longest word at
`.t-label`'s tracking (0.18em) — 166px, chosen because that's what a third of a
390px card gives you. Below 388px (and again at 768-775px, where the grid drops
to 4 columns), the row is wider than the card and the whole page scrolls
horizontally.

Fix: the control now sets its own `text-[10px] tracking-[0.02em]` instead of
inheriting `.t-label`'s 11px/0.18em, plus `min-w-0 wrap-anywhere` as a
structural floor so the row can never widen the page at any width, ever. This
is a deliberate, scoped exception to the "body 15px, label 11px" scale this
file fixed for the rest of the app (see "Visual identity" above) — a control
that must fit three labels across a half-width card is a different
typographic problem from an eyebrow label, and nothing else in the app faces
that constraint. Rejected: shortening the labels instead (`Meh`/`Hyped`/`Amped`
still overflows at 375px — the floor is set by any 5-letter word at that
tracking, not by "Very hyped" specifically) and keeping 11px with only the
structural floor (stops the page scroll but breaks "hyped"/"Loved" mid-word on
the smallest phones, which is worse than the type-scale exception).

**Search had no failure path.** `components/search-form.tsx`'s debounced
`searchMovies(query).then(...)` had no `.catch`. A rejected request (reproduced
live against a broken TMDB key) left `isSearching` stuck at `true` forever,
with the previous query's results still on screen and nothing telling the user
it failed. Added a `.catch` that clears the loading state and shows an inline
error, guarded by the same `requestId` ref the success path already uses — an
unguarded catch would let a stale failure clear a newer, still-in-flight
search's spinner.

**iOS standalone had no safe-area insets.** The status bar is
`black-translucent` (full-bleed under it), but the viewport never opted into
`viewport-fit=cover`, so `env(safe-area-inset-*)` resolved to 0px everywhere —
the header sat under the notch/clock and the fixed install prompt sat over the
home indicator. Added `viewportFit: "cover"` to `app/layout.tsx`'s `viewport`
export, padded the root flex column with top/bottom safe-area insets, and
added the bottom inset to `InstallPrompt`'s fixed offset. Not verified on a
physical device — only via the emitted meta tags and a source-level check that
no other fixed-position element exists to worry about.

**Tap targets were below the platform minimum.** Header nav links and list
filter chips measured 29px tall, poster overlay buttons (`overlayButtonClass`)
32×32 — under Apple HIG's 44pt / Material's 48dp floor. Raised `navLinkClass`
and `list-filter.tsx`'s `chipBase` to `min-h-11` with `flex items-center`, and
`overlayButtonClass` to `h-11 w-11`. Accepted cost: the header nav (which
already wraps to 3 rows on the narrowest phones) gets taller, and the overlay
squares on poster art are visually larger than the previous 32px — no attempt
was made to keep the smaller visual box with an invisible larger hit area,
since the squares aren't small enough on top of poster art to justify the
extra indirection.

### Files touched

`components/vote-control.tsx`, `components/search-form.tsx`,
`components/ui/input.tsx` (import only, no change), `app/layout.tsx`,
`components/install-prompt.tsx`, `components/app-header.tsx`,
`components/list-filter.tsx`, `components/ui/button.tsx`.

### Verification

1. `pnpm typecheck`, `pnpm lint` — clean.
2. `document.documentElement.scrollWidth === clientWidth` checked true on `/`
   and `/groups/[id]` at 341px live (previously false: 344 vs 326).
3. `VoteControl`'s button row cloned into fixed-width boxes at 167 / 164 /
   159.5 / 152 / 132px in the live DOM; `scrollWidth <= width` at every step
   (previously true only at 167).
4. Search failure path exercised live against a broken TMDB key: UI now shows
   an error and clears "Searching…" instead of hanging.

## Mobile navigation: stable tabs, secondary actions in More

The mobile audit above fixed the header links' tap targets but made the
underlying information architecture more visible: home carried five
equal-weight actions across two rows, `Sign out` competed with daily tasks,
there was no current-page state, and the available links changed from screen
to screen. At 390px the header measured 160px tall before the page heading.
There was no overflow or accessibility reason to shrink the targets again.

Mobile now uses four persistent bottom tabs: **My List, Search, Groups, More**.
The first three are the stable primary destinations. More opens a native
right-side dialog containing Inbox (with the pending count), Settings and
Sign out. `/inbox` and `/settings` activate More; nested group routes activate
Groups. The bar lives in the root layout so route-level `loading.tsx` files
cannot make it disappear between pages.

The existing header navigation remains unchanged from `sm` upward. On mobile,
it renders only page-specific actions that the global bar cannot replace:
Back to group on targeted search and Movie Night, plus Movie night/Add movies
on a group detail page. This keeps global navigation predictable without
hiding contextual work in More.

No icon package or dialog dependency was added. The four small line icons are
local SVG, the drawer uses the browser's modal `<dialog>` behavior for focus
containment and Escape handling, and all tab/drawer controls retain at least a
44px target. The root navigation also reserves its own content height and
raises phase 7's fixed install prompt by the same 64px when both are present,
so neither overlay covers the other.

### Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm build` and `git diff --check` — clean.
2. Live at 341×740 and 390×844: zero horizontal overflow, each tab 64px tall,
   the correct tab active on `/`, `/search`, `/groups/*` and `/settings`, and
   group-detail contextual actions visible above the page.
3. Drawer opened at 320px wide, focused its Close control, locked background
   scrolling, and closed via Escape with `aria-expanded` returning to false.
4. The live install prompt cleared the bar with a 15px gap at 390px; at 1280px
   the mobile bar was hidden and the existing desktop header nav remained flex.

## Movie detail: cached identity, live availability, launch-safe ratings

SPEC §7 names a Movie Detail screen, but phase 7 had ended without one. The
screen now lives at `/movies/[id]`, where `id` is Venn's internal movie UUID.
It reads the cached catalog row for the synopsis, art, runtime, release date and
TMDB score, plus only the caller's RLS-scoped status row.

Search results are the one place a movie may not have an internal UUID yet.
Those link to `/movies/external/[externalId]`, which validates the current
provider's numeric id, calls `cacheMovie`, and redirects to the canonical UUID
URL. Detail links set `prefetch={false}` deliberately: prefetching a poster grid
would otherwise cache every visible search result and issue a live availability
request for every visible cached movie before the user clicked anything.

### Ratings are links unless the data is licensed

The page displays the cached provider score as its visually primary `Rating`,
without a `TMDB` label that would make it look like one of several equivalent
ratings. It obtains an IMDb id through a new provider-interface method and links
to that title; Letterboxd and Rotten Tomatoes use title/year search links
because TMDB has no identifiers for them. No IMDb, Letterboxd or Rotten
Tomatoes number is scraped or presented as if it had been fetched.

This is a licensing decision, not a missing parser. Letterboxd API access is
request-only and currently excludes private/personal and recommendation
projects; Rotten Tomatoes requires an approved API/data-feed proposal; IMDb's
limited non-commercial dataset permission restricts republishing it as an
online movie database. If approved access is added later, Rotten Tomatoes
should show both the critic Tomatometer and audience Popcornmeter because they
measure different populations.

### Availability stays live and degrades independently

Watch providers use the profile region (falling back to `IN`) and remain
uncached, as phase 1a decided. Stream, rent and buy are separate sections;
provider logos hotlink the TMDB CDN, and the only outbound availability link is
TMDB's per-region watch page because the endpoint does not return provider deep
links. “Availability data by JustWatch via TMDB” renders next to every result
set to satisfy the endpoint's attribution requirement.

External-id and watch-provider calls use `Promise.allSettled`. Either can fail
without taking down the cached movie detail: an IMDb link can disappear, or the
availability section can report a temporary failure while synopsis and Venn
controls remain usable. This was exercised live when TMDB exhausted its
connection retries for the watch call; the page still returned 200 and rendered
the remaining sections.

### Card interaction

`MovieCard` links only its poster and title, leaving watched/remove/list/vote
buttons as siblings rather than creating invalid nested controls. The movie
night winner links as one non-interactive hero. Inbox candidates were the one
conflict: their entire card previously meant “resolve this share,” so resolution
is now an explicit “Choose this movie” button and poster/title open details.

### Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `git diff --check` — clean.
2. `pnpm smoke:tmdb` — pass, including TMDB 27205 resolving to IMDb
   `tt1375666` and 10 watch-provider entries plus the regional link for `IN`.
3. A real local Supabase user/session rendered the Inception detail route
   through Next with every named section and outbound source present. A
   390×844 headless-Chrome capture confirmed the hero, synopsis and fixed mobile
   navigation have no horizontal overflow or overlap at the top of the page.
   An authenticated request to `/movies/external/27205` emitted the canonical
   `/movies/<uuid>` redirect target.

---

## Google first names in groups (post-phase-7 auth follow-up)

Migration: `supabase/migrations/20260727225047_google_profile_first_names.sql`.

Group member pills, movie-night presence controls and “added by” labels all
already read `profiles.display_name`. They fell back to “Member” for Google
users because Phase 0's provider-agnostic `handle_new_user()` inserted only the
profile id and never copied OAuth metadata.

The trigger now seeds `display_name` from Google's explicit, trimmed
`given_name`. It checks `raw_app_meta_data` for the Google provider rather than
copying similarly named metadata from magic-link or future OAuth providers.
It deliberately does not split `full_name`: name order and mononyms make that
guess unreliable.

The migration also backfills existing Google profiles whose display name is
null, empty or whitespace. Its predicate leaves every meaningful existing
value untouched, so “You appear to groups as” remains authoritative after a
user customizes it. A Google account without `given_name` keeps the existing
manual-name path and “Member” fallback.

No group UI or RLS policy changed. The original pgTAP fixture mirrored the
`given_name` assumption; the production correction below replaces it with the
metadata shape the hosted project actually returns.

### Production correction: Google metadata has no `given_name`

Migration: `supabase/migrations/20260727231028_google_profile_name_shape.sql`.

The first migration's assumption was wrong for the hosted project. A read-only,
aggregate inspection after deployment found six Google identities: zero
carried `given_name`, while all six carried both `full_name` and `name`; four
profiles therefore remained blank. No names or emails were read during that
inspection.

The replacement trigger and backfill use the first whitespace-delimited part
of `full_name`, falling back to `name`. This is intentionally the minimum
interpretation needed to meet the requested “first name” behavior with the
metadata Google actually supplies here. The blank-profile predicate remains,
so the correction backfills those four profiles without overwriting either of
the two names already set manually.

---

## Install app option in the side menu (phase 7 follow-up)

**No schema change.**

```
lib/pwa-install.ts                  new -- shared beforeinstallprompt/appinstalled state
components/install-prompt.tsx       now consumes the shared hook instead of owning the event
components/mobile-navigation.tsx    "Install app" row added to the "More" drawer
```

Phase 7's install prompt was deliberately kept out of Settings/menus so it
"reads as proactive, not something a user has to go looking for." This adds a
second, permanent entry point in the mobile "More" drawer for anyone who
already dismissed the banner -- an addition to that decision, not a reversal:
the banner is untouched, and the menu row ignores the banner's `localStorage`
dismiss flag entirely.

Same three-way gating as the banner: already standalone -> hidden; a captured
`beforeinstallprompt` -> clickable row that calls `.prompt()`; iOS (no such
event exists) -> a non-interactive row with the same "tap Share, then Add to
Home Screen" text. Neither condition met -> hidden.

**Why the event moved to a module-scope singleton.** Both surfaces need the
*same* `beforeinstallprompt` event -- it can only be `.prompt()`'d once. Two
independent `useState` copies (the original per-component design) would let
one surface consume the event while the other kept showing a now-dead
install affordance: install from the banner, cancel, and the menu row would
still render "Install app" until a full page reload, `.prompt()`ing a
consumed event and throwing `InvalidStateError` silently inside the click
handler. `lib/pwa-install.ts` now holds the event at module scope and exposes
it to both components via `useSyncExternalStore`, so `appinstalled` (or a
completed prompt) clears it for both surfaces at once, no reload required.

**Behavior change worth naming:** `e.preventDefault()` on `beforeinstallprompt`
now runs unconditionally at module load, rather than only on the
not-dismissed/not-iOS path the banner previously gated it behind. Necessary
now that the menu row is a permanent surface independent of the banner's
dismiss state -- Chrome's own mini-infobar staying suppressed is the intended
outcome either way.

### Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm build` -- clean.
2. Local Supabase magic-link sign-in, then forced the mobile "More" drawer
   open via the DOM (desktop-width Chrome didn't hit the `sm` breakpoint in
   this environment). A real `beforeinstallprompt` fired for the dev server
   (valid manifest + service worker already satisfy Chrome's criteria) and
   both the banner and the menu row picked it up from the shared state.
   Dispatching a synthetic `appinstalled` event hid the menu row **and** the
   banner simultaneously with no reload -- confirms the singleton fix, not
   just that a row renders. Did not click through Chrome's real native
   install-confirmation dialog, since that installs an actual app on the
   host machine.

---

## TV shows join the catalog (post-phase-7 feature)

Migration: `supabase/migrations/20260727200002_media_type_tv.sql`.

SPEC §10 said "no TV shows" and CLAUDE.md said "Movies only." Both were wrong
the moment this was asked for, and both are now amended: TV series are
first-class catalog members, addable to personal lists and votable exactly
like movies, with one restriction -- **group-owned lists stay movies-only**,
because the recommender's candidate pool is drawn from group lists and is
movie-shaped throughout (§4.2's runtime tie-break, theatre mode's
`nowPlaying`/`upcoming`). No seasons, no episodes: a series is one row, one
vote, one list entry, per the user's explicit "ignore its episodes logic."

### One column, no new table

`movies.media_type` (`movie | tv`, default `movie`) is the only schema
addition. `movies.id`, `cacheMovie`, `searchMovies`, `/movies/[id]`,
`movie_rating`/`movie_hype`, and `recommend_movies` are all untouched --
renaming any of them to something TV-neutral would cascade into every FK,
policy and SQL function for zero behavioural gain. `movies` is now "the
catalog"; that's a naming note, not a migration.

**No REVOKE/GRANT block, and that's not an omission.** This migration creates
no table, and phase 0's `grant select on movies ... to authenticated` is
table-wide, not column-scoped, so the new column is already covered.

### External ids had to become self-describing, and the first design picked the wrong separator

`movie_external_ids` is `primary key (provider, external_id)` with one
provider name (`"tmdb"`). TMDB's movie and TV id spaces are independent and
both start at 1 -- movie `1396` and tv `1396` are unrelated titles -- so a
bare numeric `external_id` is structurally ambiguous, not occasionally so.
Every lookup site (`lib/movies/cache.ts`'s `lookup()`, `app/search/actions.ts`,
`app/movies/[id]/page.tsx`) keys on a bare string, so prefixing the id itself
(`"movie-27205"`, `"tv-1396"`) was chosen over adding `media_type` to the PK:
the prefix costs zero edits at any of those sites, the column would have
forced one at each. `MovieDataProvider`'s signatures stay unchanged --
`lib/providers/tmdb.ts`'s `parseExternalId`/`toExternalId` are the only place
the prefix is created or read, dispatching to `/movie/` or `/tv/` internally.
Existing `movie_external_ids` rows backfill with a `"movie-"` prefix
(exact, not a guess: TV support did not exist before this migration, so every
existing row already is one).

**The separator was `:` first, and a real dev server run caught it before it
shipped.** `/movies/external/[externalId]` redirected fine for `movie:27205`
in isolation but 404'd for every id once tested end-to-end through Next's
actual router: a colon in a dynamic route segment arrives at the page
percent-encoded and *undecoded* -- `externalId` came through as the literal
string `"movie%3A27205"`, which never matches the regex. Confirmed by
temporarily logging the param on a live request, not inferred. A hyphen is an
unreserved URL character and needs no encoding; switching to it fixed every
call site (`tmdb.ts`, the resolver page, `lib/ingest/extract.ts`, the
migration's backfill, both smoke scripts) in one pass, verified again against
the same live dev server afterward -- the redirect digest changed from
`NEXT_HTTP_ERROR_FALLBACK;404` to `NEXT_REDIRECT;replace;/movies/<uuid>` for
both a movie and a TV id.

### Enforcement is the RLS policy, not a trigger

`list_items_insert_via_list` and `list_items_update_via_list` (phase 3's
versions) gained one more clause: a group-owned list accepts the row only if
the movie's `media_type = 'movie'`; personal lists are unaffected. This
matches the schema's existing "narrowness of the write policy is the
enforcement" pattern (the catalog tables in phase 0, `group_members` in
phase 3) and fails the same `42501` the pgTAP suite already asserts
elsewhere. A trigger was rejected: it would only buy a friendlier error
message while duplicating the rule in a second place.

### `/search/multi` replaces `/search/movie`, and the tradeoff was measured, not assumed

TMDB's `/search/multi` blends movies and TV and tags each row `media_type`,
but it also returns `person` results (cast/crew), which `MovieDataProvider`
has no room for and which are filtered out in `tmdb.ts`. Measured against the
live API before deciding this was acceptable:

| query | `/search/movie` | `/search/multi` (movie+tv, people dropped) |
|---|---|---|
| "nolan" | 20 results | 4 of 20 (16 were people) |
| "the office" | 20 results | 18 of 20 |
| "inception" | 11 results | 13 of 13 |
| "friends" | 20 results | 20 of 20 |

Person-heavy queries lose real ground ("nolan"), but the surviving titles on
that query were mostly "Facing Nolan"/"Apocalypse Nolan" noise, not
Christopher Nolan's filmography. One round trip beats two against the ~20%
`ECONNRESET` rate phase 1a measured, and every other sampled query held up
fine or improved. `nowPlaying`/`upcoming` stay on `/movie/...` -- theatre
mode is phase 9 and unbuilt, and neither needs TV.

### The TMDB TV response shape genuinely differs, verified live against `/tv/1396`

| movie field | TV equivalent |
|---|---|
| `title` / `original_title` | `name` / `original_name` |
| `release_date` | `first_air_date` |
| `runtime` (int) | `episode_run_time` (array -- **empty `[]` for Breaking Bad**) |
| `keywords.keywords[]` | `keywords.results[]` |
| `crew[job=="Director"]` | absent; creators are `created_by[]` |

Getting any of these wrong is the exact silent failure phase 1a warned about
for movies: a mapping row lands with `fetched_at` set and zero tags, and
nothing ever re-fetches it. `scripts/tmdb-smoke.ts` now asserts non-zero
keyword **and** person counts for every curated title, not just keywords --
person is the one a `toTvTags` bug that missed `created_by` would zero out
while leaving keywords intact. `findByImdbId` now reads `tv_results` when
`movie_results` is empty; verified with `tt0903747` resolving to Breaking Bad.
`getWatchProviders`/`getExternalIds` dispatch on the parsed media type
(`/tv/{id}/...`), verified live returning `flatrate` providers and
`imdb_id: "tt0903747"`.

### TV ratings reach the group recommender, and that's by design

`setRating`/`setWatched` call `rebuild_user_tag_weights()` unconditionally, so
a `love` on Breaking Bad feeds Crime/Drama and its cast into
`user_tag_weights` exactly like a movie would -- and `recommend_movies`
reads that table when scoring *movie* candidates for a group night. This is
the one path where TV reaches group recommendations despite group lists
being movies-only, and it's intentional per the "treated just like movies"
brief, confirmed with the user during design rather than assumed. No SQL in
`recommend_movies` changed.

### Copy: neutral where lists mix, unchanged where they can't

`app/page.tsx` ("N titles", "Nothing on your list matches it yet", "Search
movies & shows"), `components/search-form.tsx`'s placeholder, and
`components/inbox-item.tsx`'s "Choose this title" all went neutral --
personal lists and the Inbox can both hold TV now. Group screens
(`app/groups/[id]/page.tsx`, movie night) keep "movies" verbatim: they
genuinely can't hold anything else. `components/movie-card.tsx` grew an
optional `mediaType` prop rendering `"· TV"` next to the year; omitted
entirely (not wired up) on the group list and movie-night cards, since a
badge that can never fire there is dead code, not a feature.

`app/movies/[id]/page.tsx` reads `media_type` to swap "Movie details" for
"Show details" and to drop the Letterboxd/Rotten Tomatoes rating links for
TV -- both are film-only search links (Letterboxd has no TV catalog at all),
so showing them for a series would be a working link to nothing relevant.
IMDb stays for both, keyed off `getExternalIds`.

### `searchMovies` filters TV before the list gets a look, not after

`app/search/actions.ts` resolves whether the target list is group-owned
*before* calling `provider.search`, then drops `mediaType === "tv"` results
from the array before any of the existing `movie_external_ids`/`list_items`
lookups run. The action previously only queried `lists` when `listId` was
absent (resolving the caller's personal default); it now queries it in the
passed-`listId` branch too, to read `owner_group_id`. Chosen over rendering
TV results with a disabled "Add" button: no dead affordance, and confirmed
live in Chrome -- the same "breaking bad" query that returns the series plus
four movies at `/search` returns only the four movies at
`/search?list=<groupListId>`.

### Tests: a TV fixture with no tags, and a control alongside every negative

`supabase/tests/rls.test.sql` gained a fourth fixture movie
(`77777777-...`, `media_type = 'tv'`), deliberately given **no**
`movie_tags` row so it doesn't perturb the `movie_tags` count assertion.
Per the standing rule (this file, phase 0) that a negative needs a positive
control on the same table: *"control: A can add a TV title to its own list"*
(`lives_ok`, personal list) sits next to the new *"D cannot add a TV title
to the group's list"* (`throws_ok`, `42501`). `plan(75)` → `plan(77)`; the
`movies` count assertion (3 → 4) was the only other one perturbed --
checked every `count(*) from list_items` assertion individually rather than
assuming, since the new fixture and control both write into that table.
Local run: 77/77.

### Deploy-skew window, named rather than left unaddressed

The backfill rewrites `movie_external_ids.external_id` in one migration
transaction, but a deployed instance's in-memory code keeps looking up bare
ids until it redeploys. At 4-6 users this is cosmetic: a miss just re-fetches
cleanly under the new prefixed scheme, per phase 1a's write-order argument
that a cache miss is always safe to repeat. Not worth a feature flag at this
scale.

### Verification

1. `supabase db reset` -- all seven migrations apply clean, in the order the
   remote actually stamped them (see below). `supabase test db` -- 77/77.
2. `pnpm smoke:tmdb` -- all nine films plus two TV titles (Breaking Bad,
   Game of Thrones) cache with non-zero keyword and person counts; a second
   pass makes zero TMDB calls; zero orphaned `movies` rows; `findByImdbId`
   still resolves `tt1375666` → `movie-27205`.
3. `pnpm smoke:ingest` -- 11/11, including a new `themoviedb.org/tv/...` case
   extracting `tv-1396`.
4. `pnpm typecheck`, `pnpm lint`, `pnpm build` -- clean.
5. Real magic-link session against the local stack + Mailpit, driven two ways:
   - Raw authenticated requests confirmed the redirect digest
     (`NEXT_REDIRECT;replace;/movies/<uuid>`) for both `movie-27205` and
     `tv-1396` through `/movies/external/[externalId]`, and the TV detail
     page rendering "Show details" with an IMDb link (`tt0903747`) and no
     Letterboxd/Rotten Tomatoes rows. One `getExternalIds` call hit the
     documented ~20% `ECONNRESET` rate mid-verification; three immediate
     retries succeeded, confirming transient network flakiness rather than a
     TV-specific bug.
   - **Live Chrome, real clicks:** searched "breaking bad" at `/search` --
     blended grid with a "· TV" badge on the three TV rows and none on the
     movie rows; added Breaking Bad to the personal list and confirmed the
     badge and hype control on `/`; created a group and searched "breaking
     bad" from its `/search?list=...` -- **zero** TV rows in the results,
     confirming the group-list filter live rather than by code reading alone.
6. Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP, same route as
   every prior phase. `apply_migration` stamped `20260727200002` -- earlier
   than this migration's original local filename
   (`20260728010000`, chosen before knowing the stamp), landing it between
   phase 5 and the Google-profile pair rather than after them. The local file
   was renamed to match, `db reset` and `test db` re-run to confirm the
   reorder doesn't matter (this migration touches `movies`/`list_items` only,
   nothing the profile trigger migrations depend on or vice versa), and
   `supabase migration list` now shows local and remote agreeing on all seven
   versions. `get_advisors(security)` shows the same four pre-existing WARNs
   as before (three SECURITY DEFINER functions plus leaked-password
   protection) and nothing new -- this migration added no function.

---

## Deleting a group (post-phase-7 feature, revises Phase 3)

Not a numbered phase -- requested directly, because an accidentally-created
group had no way to go away. Phase 3's own grants comment said the quiet
part out loud: *"No UPDATE or DELETE for anyone: renaming, leaving and
deleting groups are out of scope this phase, and withholding the grant is
how that stays true."* That sentence, and its restatement under "Deferred,
deliberately" below Phase 3's write-up, are both reversed here for delete
only. Leaving and renaming a group are untouched, and stay out of scope for
the same reason they always were.

Migration: `supabase/migrations/20260728093117_group_delete.sql`.

### The grant was the enforcement, and removing it is the whole change

`groups` carried `grant select, insert on groups to authenticated` and
nothing else. The entire change is `grant delete on groups to authenticated`
plus one policy -- no REVOKE block, because no table is created here and
CLAUDE.md's REVOKE-then-GRANT rule doesn't apply (same reasoning
`media_type_tv.sql` used). Phase 3 already ran `revoke all on groups ...`,
and hosted default privileges only fire at table creation, so there was
nothing to revoke a second time.

### `created_by` is the predicate, not the member role

`groups_delete_owner` checks `created_by = (select auth.uid())`, not a join
against `group_members.role = 'owner'`. The two agree today --
`handle_new_group` is the only writer of `role = 'owner'`, and there is no
ownership transfer -- but `created_by` lives on the row being deleted, so
the policy needs no join and can't drift from a membership row. No
`is_group_owner()` helper was added alongside `is_group_member`: SECURITY
DEFINER exists in this schema to escape RLS recursion or to read rows the
caller can't otherwise SELECT (`is_group_member`, `join_group_by_code`);
neither problem applies here, since the owner can already SELECT the group
being deleted. A plain policy is the whole mechanism.

### The cascade needed no grants of its own

`ON DELETE CASCADE` runs as the system, not as the deleting role -- it isn't
subject to that role's grants or RLS. Every FK into `groups` already
cascades: `group_members.group_id` and `lists.owner_group_id` (both Phase
3), and `list_items.list_id` into `lists` (Phase 0). Grepped every migration
for `references groups` to confirm those are the only two, and that nothing
else (no `movie_nights` -- Phase 11, unbuilt) points at `groups` yet. So
`delete from groups` already cleanly removes a group's membership, its one
list, and that list's items, with no additional DB work.

### `.select()` on the delete would report a success as a failure

`deleteGroup` (`app/groups/actions.ts`) does not chain `.select()` after the
delete. By the time `RETURNING` would evaluate `groups_select_member`, the
cascade has already removed the caller's own `group_members` row, so the
returned row would be filtered out -- the same trap `createGroup`'s comment
documents for `handle_new_group`'s AFTER trigger, mirrored here for the
opposite direction. Checking only `error` avoids it. A non-owner's forged
request is a silent no-op: RLS filters the row from the DELETE's target set,
no error is raised, nothing changes -- the same shape as "A cannot update
B's profile" in the RLS suite. Not worth a pre-flight ownership read, since
the UI never renders the control for a non-owner in the first place.

### UI: a danger zone, not a modal

The delete control lives at the bottom of `/groups/[id]`
(`components/delete-group-panel.tsx`), rendered only when
`group.created_by === caller`, gated by reading the same column the policy
checks rather than trusting `group_members.role` as a second source of
truth. Confirmation is a two-step inline swap ("Delete group" → "Delete for
everyone? / Cancel"), shaped on `RevokeButton`
(`components/ingest-token-panel.tsx`) -- a `useActionState` form with a
hidden `id` field. No native `<dialog>`: the app's two existing sheets
(`mobile-navigation.tsx`, `group-actions-fab.tsx`) exist to host navigation
or two forms apiece, which a single destructive button doesn't need, and no
new dependency was worth asking for over one `useState`.

### Deferred, deliberately

Leaving a group and renaming a group remain out of scope -- neither table
gained an UPDATE grant, and `group_members` still has none at all. The
"last member to leave" question Phase 3 flagged stays closed, untouched,
because a non-owner still has no way to leave a group at all.

### Tests

`supabase/tests/rls.test.sql` gained five assertions, appended at the very
end of the impersonated block (immediately before `------ anon access`),
since they destroy the shared group fixture (`99999999-...`) that the
Phase 4 recommender assertions above depend on -- inserting them earlier
would break everything after. `plan(77)` → `plan(82)`.

Still impersonating D (a member, not the owner) when the block opens: D's
delete matches no row (`select count(*) from groups` stays 1) -- not
`throws_ok`, since `authenticated` now holds the DELETE grant and RLS
filters the row silently rather than raising. Per the standing "no negative
without a control on the same table" rule, C (the creator) then gets
`lives_ok` on the same delete. The group's list id is captured into a temp
table *before* the delete runs, because after the group is gone `lists`
cascades away too, and a `list_items` assertion joined through
`lists where owner_group_id = ...` would then match against an empty
subquery and pass vacuously -- proving nothing about the cascade. The three
cascade assertions (`group_members`, `lists`, `list_items`, all zero) run
after `reset role`, not as C: a zero read through RLS proves nothing once
the caller's own `group_members` row is gone, since it would pass even if
the cascade hadn't fired. `reset role` is the idiom this file already uses
to reach the superuser; `set local role postgres` isn't valid here, since
`authenticated` isn't a member of that role.

### Verification

1. `supabase db reset` -- migration applies clean.
2. `supabase test db` -- 82/82.
3. `pnpm typecheck`, `pnpm lint`, `pnpm build` -- clean.
4. Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP; local file
   renamed to the stamped version, `db reset` + `test db` re-run to confirm
   the reorder is harmless.
5. `get_advisors(security)` -- no new findings from the added policy.
6. `pnpm dev`, real signed-in session: the danger zone renders and deletes
   correctly for the creator; a non-creator member sees no danger zone at
   all; `/groups/<deleted id>` and `/groups/<deleted id>/night` both 404
   rather than crash (the night page's `groups_select_member` gate returns
   `notFound()` before ever reaching `recommend_movies`, so that RPC's
   non-member guard is never hit); the other member's `/groups` list and
   personal data are unaffected.

---

## Leaving a group (post-phase-7 feature, revises Phase 3)

The other half of the deferral the entry above reversed. Delete gave the
*creator* a way out; a member who joined by invite code still had none, so
Phase 3's *"renaming, leaving and deleting groups are out of scope this
phase, and withholding the grant is how that stays true"* is now reversed
for leaving too, again on direct request. Renaming is the only third of that
sentence still standing, and `groups` still holds no UPDATE grant.

Migration: `supabase/migrations/20260728110640_group_leave.sql`.

### "Member" means non-owner, and that is what closes the last-owner question

`group_role` is a two-value enum `('owner','member')`, and `/groups` renders
`{m.role}` verbatim as a badge, so "member" is already this codebase's word
for *not the creator*. Read that way, the two exits partition the group
exactly: the creator deletes (shipped in the entry above), everyone else
leaves. Nobody is stranded and no third mechanism is needed.

The Phase 3 note said leaving *"opens the last-owner question."* It does not
open it here — it closes it, and by construction rather than by omission.
The owner cannot leave, so a group keeps its owner until that owner deletes
it; an ownerless or memberless group is unrepresentable. That is a stronger
guarantee than the delete entry's version of the same claim, which rested
only on nobody being able to leave at all.

The alternative considered and rejected: let the owner leave, transferring
ownership to the next-oldest member and deleting the group when the last
member goes. That needs an UPDATE grant on `group_members`, a new SECURITY
DEFINER function to carry the transfer, and it invents ownership transfer,
which this schema deliberately does not have.

### The predicate is on the row being deleted, same as `created_by` was

`group_members_delete_self` is
`using (user_id = (select auth.uid()) and role <> 'owner')`. That looks like
a reversal of the delete entry's argument for preferring `groups.created_by`
over a `group_members.role` join, and isn't: the principle there was *use the
column that lives on the row being deleted*. There, the row was the group, so
`created_by` was on-row and `role` would have been a join. Here the row being
deleted **is** the membership row, so `role` is the on-row column and
`created_by` would be the join. Same rule, opposite table.

The two policies cannot drift apart about who the owner is, either:
`handle_new_group` is the only writer of `role = 'owner'`, and it writes it
for `new.created_by`.

`<> 'owner'` rather than `= 'member'` so the predicate stays correct if
`group_role` ever gains a third value. A plain policy again — the caller can
already SELECT their own membership row through
`group_members_select_peers`, so there is no recursion or unreadable row to
justify SECURITY DEFINER.

### The grant enables leaving, not kicking

`grant delete on group_members to authenticated` is the widest part of this
change, and the `user_id = (select auth.uid())` clause is the entirety of
what keeps removing *another* member unbuilt. The owner has no more power
here than anyone else: C cannot remove D, and that is asserted. No REVOKE
block, for the reason `media_type_tv.sql` and `group_delete.sql` both state —
no table is created, so CLAUDE.md's REVOKE-then-GRANT rule doesn't apply, and
hosted default privileges only fire at table creation. `group_members` still
has no INSERT or UPDATE grant, so its only write paths remain
`handle_new_group` and `join_group_by_code`.

### `.select()` on the delete would report a success as a failure

The same trap as `deleteGroup`, one table over. `leaveGroup`
(`app/groups/actions.ts`) chains no `.select()`: `RETURNING` would evaluate
`group_members_select_peers` *after* the caller's own row is gone, at which
point `is_group_member` is false and a successful leave comes back as an
empty, filtered result. Checking `error` alone avoids it. An owner's forged
POST is a silent no-op — RLS filters the row out of the delete's target set.

The `.eq("user_id", userId)` filter is not the enforcement; the policy would
narrow the statement to the caller's own non-owner row regardless. It is
there because a statement that reads "delete every member of this group" is
worse for the next reader than one extra `getClaims()`.

### A leaver's movies stay, and their name stops resolving

Nothing has an FK into `group_members` (grepped for `references
group_members`; its PK is the composite `(group_id, user_id)`), so leaving
cascades to nothing. In particular `list_items.added_by` references
`profiles`, not membership — so the movies a leaver added stay on the
group's list. That is the intent: the items belong to the group, and
deleting them on the way out would silently destroy shared data.

What does change is that their *name* stops resolving.
`profiles_select_visible` exposes a profile only to shared-group peers, so
once the membership row is gone, remaining members who share no other group
with the leaver read `null` for `display_name`, and `added by <name>` falls
back to `added by Member`. All three `profiles(...)` embeds already guard
this with `?? "Member"` — `app/groups/[id]/page.tsx:129,162` and
`app/groups/[id]/night/page.tsx:68` — so it is a cosmetic fallback, not a
crash. Confirmed live, not just reasoned.

### UI: membership, not a danger zone

The control sits in the same slot as the delete panel — the bottom of
`/groups/[id]` — as the else branch of the existing
`group.created_by === caller` ternary, so exactly one of the two always
renders. `components/leave-group-panel.tsx` is a sibling of
`delete-group-panel.tsx` rather than a mode flag on it: the copy and the
stakes differ enough that a flag would make the text conditional in three
places for no gain.

Two deliberate differences, both saying *this one is recoverable*: the
heading is "Membership", not "Danger zone", and the idle trigger is
`buttonClass("ghost")` rather than the `beam` warning fill, which is reserved
for the click that actually destroys something (the confirm submit keeps
`beam`). The copy names the recovery — *"You'll need the invite code to
rejoin"* — since after leaving, the group page 404s and the code is the only
way back.

### Deferred, deliberately

- **Renaming a group.** Still no UPDATE grant on `groups`; the last third of
  Phase 3's sentence.
- **Removing another member.** Blocked by the `user_id = auth.uid()` clause,
  not merely unbuilt.
- **Ownership transfer.** Still does not exist, and the owner-cannot-leave
  rule is what makes its absence safe.

### Tests

`supabase/tests/rls.test.sql` gained five assertions, immediately before the
group-delete block, since they need the group and both members alive and that
block destroys the fixture. `plan(82)` → `plan(87)`.

The block **never switches role, only `request.jwt.claims`**, and ends with D
impersonated and back in the group. Both are load-bearing: the delete block
below opens "still impersonating D" and reads `count(*) from groups` as D, so
a stray `reset role` or a left-over C impersonation here would surface down
there as a failure that looks unrelated to its cause.

Assertions, in order: C cannot leave its own group (the `role <> 'owner'`
clause; not `throws_ok`, since `authenticated` holds the DELETE grant now and
RLS filters silently); `lives_ok` for D leaving — the control the standing
"no negative without a positive on the same table" rule requires; D can no
longer read the group afterwards, which is the user-visible 404 and is
self-controlling, since only a real D could have made the delete succeed;
D rejoins via `join_group_by_code('TESTCODE')`, which asserts that leaving is
recoverable *and* doubles as the fixture restore (wrapped in `is()` rather
than called bare, since a naked `select` of a function emits a non-TAP row);
and finally C cannot remove D.

That last one is why the C-removes-D shape was chosen over D-removes-C. D
removing C is stopped by `role <> 'owner'` on its own, so it would say
nothing about *who* may remove whom. D's row is `role = 'member'`, which
passes that clause and leaves `user_id = auth.uid()` as the only thing
refusing C — so the two negatives now pin one clause each. Verified by
mutation: dropping either clause from the policy in a throwaway transaction
drops the corresponding row count to 0, where the assertion demands 1.

Asserting "D can no longer read the group" rather than reading the row count
outside RLS is also what buys the no-`reset role` property — with the
membership row gone, `is_group_member` false and no row are equivalent, so
the weaker-looking read costs nothing.

### Verification

1. `supabase db reset` — migration applies clean.
2. `supabase test db` — 87/87.
3. `pnpm typecheck`, `pnpm lint`, `pnpm build` — clean.
4. Policy mutation-tested in a rolled-back transaction, both clauses
   independently pinned (above).
5. Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP; local file
   renamed to the stamped version (`20260728110640`), `db reset` + `test db`
   re-run to confirm the reorder is harmless.
6. `get_advisors(security)` — the same pre-existing WARNs, nothing new from
   the added policy.
7. `pnpm dev`, two real signed-in accounts: the joiner sees the Membership
   panel (the owner sees only the Danger zone), "Leave group" swaps to the
   confirm row, Cancel restores it, and Leave lands on `/groups` with the
   group gone; `/groups/<id>` and `/groups/<id>/night` both 404 for them
   afterwards rather than crashing. The joiner was given a display name
   first, so the fallback was actually observable: the owner's view read
   "added by Robin" before and "added by Member" after, with the movie still
   on the list and Robin gone from the member chips. The joiner then rejoined
   with the invite code, and both the group and "added by Robin" came back.

---

## Android TWA Quick Settings search (post-phase-7 distribution feature)

**No schema change.** This revises §1's distribution choice and §10's native
non-goal narrowly: Venn still has one web UI, but Android users may install a
signed Trusted Web Activity wrapper to gain an OS-level Quick Settings tile.
It is not a React Native or Capacitor rewrite.

### One web product, one native seam

`android/` is a Bubblewrap-generated TWA project that is now maintained
directly. The package is `com.m3rcury02.venn`; the verified origin remains
`https://venn-roan.vercel.app`. Android Browser Helper owns the browser
session and renders the deployed Next.js app, so catalog searches and adds
still use the existing `/search` UI and server-side provider boundary.

The primary custom native behavior is `SearchTileService`. Its action intent
targets `LauncherActivity` with `/search` as the HTTPS data URI. Android
Browser Helper already respects an incoming verified URL, which avoids a
second search implementation and keeps auth in the web session.

The tile is an action, not a toggle: it always reports active and opens
search. Locked devices use `unlockAndRun`; Android 14+ uses the required
`PendingIntent` overload, while Android 7–13 use the older overload behind
the runtime SDK check.

### Tile discovery

Android 13 introduced `StatusBarManager.requestAddTileService`, so the first
normal launcher start requests the tile once and then launches the TWA from
the system callback. The result is persisted whether the user accepts,
declines, or already has the tile. Deep links, shares, and tile launches do
not trigger the prompt. Android 7–12 expose the service in the Quick Settings
editor but cannot show the system add prompt.

Declining that first prompt suppresses future unsolicited prompts, but it no
longer makes the decision permanent. Android requests to `/settings` render a
Quick access section whose explicit button opens
`venn://quick-settings` through a package-scoped Chrome intent.
`QuickSettingsSetupActivity` retries the placement API on Android 13+ and
reports added/already-added/fallback results with a toast. Android 7–12 get
the manual Edit instructions because no supported placement API exists there.
The control stays visible after success so it also recovers from a tile being
removed later.

The browser fallback returns to `/settings?tileSetup=requires-app`; this
turns an absent or outdated wrapper into an update message instead of a dead
button. iOS and desktop never render the section. The first-launch activity
and explicit setup activity share one tile-request helper so their package,
component, label, and icon cannot drift.

No notification delegation was retained. The generated notification
permission and delegation service were unrelated to search and would have
expanded the wrapper's permissions without a current requirement.

### Trust and signing

The release certificate is a private RSA-4096 key outside the repository.
Gradle reads it from `~/.config/venn` by default or from explicit
`VENN_ANDROID_*` environment variables. `.gitignore` excludes Android
keystores and build artifacts.

`public/.well-known/assetlinks.json` binds the production origin to the
package and certificate SHA-256 fingerprint. It is explicitly public in the
Supabase auth proxy because Android fetches it without a Venn session. The
same fingerprint is recorded in `twa-manifest.json` for operator visibility.
The private key and password are never committed.

Web releases remain normal Vercel deployments and need no APK update. Native
changes require a higher `versionCode`, the same package ID, and the same
signing key; friends can install the replacement APK in place. The exact
build, install, backup, and manual tile steps live in `android/README.md`.

### Toolchain

The wrapper pins Android Gradle Plugin 9.3.1, Gradle 9.6.1, Android SDK 37,
Java 17 bytecode, Android Browser Helper 2.7.2, and minimum Android API 24.
AGP 9's built-in Kotlin support compiles the two native Kotlin classes
without a separate Kotlin Gradle plugin.

### Verification

1. `pnpm typecheck`, `pnpm lint`, and `pnpm build` — clean.
2. `lintRelease assembleRelease --warning-mode all` — clean with the pinned
   API 37 SDK; the release APK is generated successfully.
3. `apksigner verify --print-certs` — one valid RSA signer, and its SHA-256
   digest exactly matches `assetlinks.json`.
4. `aapt dump badging` — package `com.m3rcury02.venn`, version code 2,
   minimum API 24, target/compile API 37.
5. A local production server returns `/.well-known/assetlinks.json` as
   unauthenticated `200 application/json` with bytes identical to the public
   file.
6. Real-device prompt, tile placement, and TWA verification remain a device
   check after the v1.0.1 APK is installed. Production Digital Asset Links
   already report `linked: true`.

---

## Global movie vote percentages (post-phase-7 feature)

Migration:
`supabase/migrations/20260730115115_global_movie_vote_percentages.sql`.

Movie and TV detail pages now show two global, current-vote aggregates:

- **Hyped** = `hyped | superhyped` divided by every non-null hype vote,
  including `dont_care`.
- **Loved** = `love` divided by every non-null watched rating.

The denominators stay separate because the status constraint makes hype an
unwatched signal and ratings a watched signal. Combining them would make each
percentage depend on how many voters happened to have watched the title rather
than on the relevant choice. Both values round to whole percentages and return
null when their own pool is empty. There is no minimum sample threshold and no
historical reconstruction: marking a title watched clears its current hype, as
Phase 2 already decided.

### The aggregate is the privacy boundary

`get_movie_vote_percentages(p_movie_id uuid)` is `SECURITY DEFINER` because
`user_movie_status` remains readable only by its row owner. It returns exactly
two nullable integers -- no user ids, individual votes, or exact sample counts
-- and rejects a missing `auth.uid()`. Execution is revoked from `public`,
`anon`, `authenticated` and `service_role`, then granted back only to
`authenticated`, preserving the explicit local/hosted grant parity established
in Phases 0 and 4.

No policy was widened, and no table or index was added.
`user_movie_status_movie_id_idx` already serves the function's only predicate.

### Detail-page refresh stays inside Supabase

The initial aggregate is fetched with the existing authenticated movie-detail
queries. `MovieDetailStatus` owns both the new "Venn voters" panel and the
existing personal-status panel; after a detail-page status change, it calls
only the aggregate RPC and replaces the two displayed values. It does not
refresh the whole server route, because doing so would repeat the page's live
TMDB external-id and watch-availability requests after every vote. A failed
aggregate refresh retains the last rendered values rather than replacing them
with zero.

The panel shows percentages without sample counts. Its empty states distinguish
"No hype votes yet" from "No ratings yet", since either pool can be empty while
the other has data. The shared detail route means the same behavior applies to
movies and TV series, matching the catalog rule.

### Verification

1. `supabase db reset` applied all ten migrations cleanly.
2. `supabase test db` -- **93/93**. Coverage includes `hyped`,
   `superhyped`, `dont_care`, `like` in the Loved denominator, separate
   rating/hype pools, empty pools, whole-number rounding, cross-user
   aggregation while raw peer rows remain hidden, and anonymous denial.
3. `pnpm typecheck`, `pnpm lint`, and `pnpm build` -- clean.
4. A real local magic-link session rendered a seeded detail page at 390px wide
   with **100% Hyped** and **67% Loved**, the viewer's Very hyped control, both
   independent panels, and no horizontal overflow.
5. Real DOM clicks changed that viewer to Meh and then cleared the vote. The
   aggregate panel moved **100% → 0% → No hype votes yet** while Loved remained
   67%, confirming that the post-vote browser RPC refreshes server-derived
   percentages rather than recomputing them from local state.

---

## Phase 8 — onboarding and library imports

Migration:
`supabase/migrations/20260730180000_phase8_onboarding_imports.sql`.

### Onboarding is a database-enforced gate

`profiles.onboarded_at` is the durable completion marker. Every authenticated
app request whose profile has no marker is redirected to `/onboarding`; public
auth, ingest, share, PWA, and offline routes keep their existing exemptions.
Existing ratings count toward the ten-title requirement, so returning users do
not have to rate the same films again.

The first screen collects only username and region. It preserves an existing
display name and uses the username as a fallback only when the display name is
blank. Regions come from the provider's country configuration rather than a
hand-maintained subset. The second screen pages through region-aware popular
movies and records `hate`, `like`, or `love` as watched ratings without adding
those titles to the default list.

The browser cannot write `onboarded_at`: Phase 0's table-wide profile UPDATE
grant is replaced with the same editable profile columns minus that marker.
`complete_onboarding()` checks the authenticated profile and counts ten
non-null ratings inside one `SECURITY DEFINER` function, rebuilds tag weights,
then stamps the marker. This keeps a client-side redirect or forged update from
bypassing the taste baseline.

### Imports are durable normalized work, not uploaded archives

Two owner-only RLS tables back the workflow:

- `imports` holds source, state, exact progress, the final unmatched summary,
  errors, and timestamps.
- `import_rows` holds only normalized matching and status data. Raw IMDb CSVs
  and Letterboxd ZIP contents stay in the browser.

Both tables follow the required REVOKE-first grant pattern. Only one
`uploading` or `processing` import may exist per user, enforced by a partial
unique index. Rows are uploaded in batches of 200, then a root-layout runner
processes one durable row per request while any authenticated Venn screen is
open. Navigation does not stop it, and the next app session resumes the oldest
processing job. No external queue or Phase 9 infrastructure was introduced.

`csv-parse` and `fflate` are the two approved focused dependencies. IMDb accepts
official ratings and watchlist CSVs, resolves exact IMDb ids through the
provider, imports movies and TV series, and skips episodes, games, and podcasts.
Letterboxd accepts the official account-export ZIP and merges `ratings.csv`,
`watched.csv`, `watchlist.csv`, and `likes/films.csv`. Its precedence is liked,
rating, watched, then watchlist; the liked file therefore maps to `love`
regardless of stars. Letterboxd rows are movies only and match automatically
only when one provider result has the normalized title, year, and media type.
Everything ambiguous enters the manual review queue with candidate suggestions
and provider-backed search.

Rating thresholds are exactly SPEC §6. Every matched title is added to the
user's personal default list. Imported watched/rating state wins over an
existing Venn state and carries `watched_at = null`, because neither export is
being treated as a reliable viewing-date source. A watchlist row is the one
exception: it never downgrades an already-watched title. All automatic matches
finish through `finish_import()`, which locks the job and rebuilds
`user_tag_weights` exactly once. A later user-selected review match rebuilds
weights immediately so a partially reviewed library is not stale.

Provider calls remain server-side and still flow exclusively through
`lib/providers/`. `cacheMovieByImdbId()` records a provider=`imdb` mapping after
the exact lookup, so repeated imports can resolve without another find request.
Manual review validates row ownership through RLS before loading or caching the
chosen provider title.

### Verification

1. `supabase db reset` applies all eleven migrations cleanly, and
   `supabase migration list` confirms the linked project is at the same Phase 8
   migration.
2. `supabase test db` — **113/113**. The 20 Phase 8 assertions cover the
   protected onboarding marker, the ten-rating gate, owner-only import rows,
   cross-user isolation, atomic list/status application, unknown watch dates,
   watchlist non-downgrade behavior, exact completion counts, and anonymous
   denial.
3. `pnpm smoke:imports` — **13 assertions** across IMDb ratings/watchlist and a
   Letterboxd export ZIP, including quoted commas, unsupported IMDb episodes,
   media-type mapping, deduplication, and Letterboxd precedence.
4. `pnpm smoke:tmdb` — pass, including an exact IMDb-to-TMDB movie resolution,
   matching internal cache id, and zero-provider-call warm cache behavior.
5. `pnpm typecheck`, `pnpm lint`, and `pnpm build` — clean.
6. A real local magic-link session ended at `/onboarding` and rendered the
   username/region step. Its cookie was redirected from `/settings` back to
   onboarding, while the same request without a cookie redirected to `/login`.

---

## Phase 9 — theatre mode: same picker, release-status filter

Migration: `supabase/migrations/20260730190000_phase9_theatre.sql`.

§4.2 defines theatre mode's candidate pool as `nowPlaying(region)` union
upcoming within N weeks. Phase 0 deferred `movie_releases` here explicitly;
`nowPlaying`/`upcoming` have existed on `MovieDataProvider` since phase 1a with
nothing calling them. This phase wires that pool into the existing recommender
and picker UI — same scoring, same explanations, same reroll, a different
candidate source.

**Decided this session, no spec default existed for any of them:** the
upcoming window is 4 weeks; when present members' regions disagree, the caller's
own region is used and a note is shown, rather than refusing to pick; and
theatre mode swaps §4.4's "Nobody here has seen it" (trivially true for every
theatre candidate, since none of them can be watched yet) for a release-status
line — "In cinemas" or "Out 14 Aug".

### `movie_releases`, and why it departs from §3's column list

```
movie_releases  movie_id, region, release_date, release_type, fetched_at
                PK (movie_id, region, release_type)
```

Two departures, both load-bearing:

- **`release_date` is nullable**, though it isn't in §3's text. Phase 1a's own
  documented trap: TMDB sends `""`, not null, for an unknown date;
  `toReleaseDate` coerces that to null. A `NOT NULL` column would throw on
  exactly that title and fail the entire refresh over one film with no known
  date.
- **`fetched_at`** isn't in §3's column list at all. It's the freshness signal
  `lib/movies/theatre.ts` reads to decide "serve from cache" vs "hit TMDB
  again" — the same role `movies.fetched_at` plays for the main catalog, just
  never previously needed by a table with more than one row per movie.

`release_type` is a two-value enum (`theatrical`, `upcoming`), one per list
endpoint — not TMDB's finer 1–6 release-type taxonomy, which lives behind
`/movie/{id}/release_dates`, a per-title call §4.2 never asked for. Worth
knowing: the list endpoints' `release_date` is TMDB's *primary* release date,
not strictly a region-specific one, even filtered by `region=`. Good enough for
a "when's it out" line; not a source of truth for exact regional release dates.

Grants and RLS follow the catalog pattern exactly (`movies`/`movie_tags`):
REVOKE-then-GRANT, `select` to `authenticated` with `using (true)`, full DML to
`service_role` only, no write policy for anyone else — the same "absence is the
enforcement" argument phase 0 made for the catalog tables.

### `recommend_movies`: dropped and recreated, not overloaded

A `p_candidates uuid[] default null` parameter was added. `NULL` is home mode
(candidates from group-owned lists, byte-identical to phase 4's query, now
split out as a `pool` CTE feeding `candidates`); non-null is the theatre-mode
override — the caller-supplied set entirely replaces the group-list pool.

This required a `DROP FUNCTION` and full recreate, not a second overload:
PostgREST resolves an `rpc()` call by the exact set of named parameters
supplied, so a 3-arg and 4-arg `recommend_movies` coexisting would make the
existing 3-arg call from the night page ambiguous. Grants do not survive a
`DROP`, so `revoke`/`grant execute` were reissued verbatim on the new
4-argument signature.

No membership guard was added on `p_candidates`, unlike `p_present`. The
function's privacy boundary is its *return shape* (aggregates only, no
per-member row), and a member could already put an arbitrary title in front of
this function by adding it to the group list — `p_candidates` grants no new
capability the caller didn't already have.

### `lib/movies/theatre.ts`: the cache, and its one silent-bug risk

`theatreCandidates(region)` reads `movie_releases` for the region; if the
newest `fetched_at` is inside `TTL_HOURS` (12), it returns those rows with
**zero TMDB calls**. Otherwise it calls `nowPlaying`/`upcoming`, resolves
external ids against `movie_external_ids` in one bulk query, and runs
uncached titles through `cacheMovie` — `nowPlaying` first, capped at
`MAX_NEW_TITLES` (24) so a cold region can't blow a serverless request's time
budget.

**Delete-then-insert, not upsert-plus-diff, is the correctness argument.** A
refresh recomputes the *complete* wanted set for the region every time, so
anything not in that set — most importantly a film that has left cinemas and
dropped out of `nowPlaying` — has to be removed, or the region's pool grows
monotonically while the freshness check keeps reporting "fresh" over titles
that closed months ago. This was verified against real state, not just argued:
`pnpm smoke:theatre` plants a row for Inception (a 2010 release, certainly not
in any current `nowPlaying`/`upcoming` response) with a forced-stale
`fetched_at`, triggers a refresh, and confirms the row is gone.

**The cap and the TTL would otherwise contradict each other.** A capped
refresh only resolves `MAX_NEW_TITLES` of however many titles are actually
wanted; stamping those rows `fetched_at = now()` would mark the whole region
"fresh" for the full TTL, silently freezing the pool at a partial set for 12
hours. Instead, a truncated refresh stamps `now() - TTL_HOURS + 1 minute`, so
the region reads fresh for one more minute and then a subsequent render
retries — the remainder (now mostly already cached) resolves on that pass.
Observed directly in `pnpm smoke:theatre`'s own live run: a cold `IN` region
wanted 39 titles, the first refresh capped at 24 and returned 23 (one title's
cache attempt evidently failed silently, which is by design — a per-title
failure inside the concurrency-limited batch is swallowed and just leaves that
title unresolved for the next pass, not the whole refresh), and the *second*
refresh (triggered by `smoke:theatre`'s own forced-staleness step) picked up
the rest and landed at the full 39. Convergence in two renders, exactly as
designed, not merely as argued.

### Does theatre-mode scoring actually differentiate?

This was the open risk flagged before implementation: theatre candidates carry
no hype votes and no ratings from anyone (nothing has been watched yet by
construction), and new/upcoming releases are exactly where TMDB keyword
coverage is thinnest — phase 1a's own baseline table measured 5–22 keywords
per film, but only on *established* titles. If `taste` collapsed toward
uniform for thin-tag new releases, the tie-break (`seen_count` — always 0 in
theatre mode — then `rating_external`, then `runtime`) would end up doing all
the ordering, and "three plausible films rendered" would prove nothing about
whether the recommender ran at all.

Checked directly against the real cached catalog from `smoke:theatre`'s own
run (not synthetic tags): two throwaway users were given opposite ratings on
two real, already-cached, genre-disjoint films (`Spirited Away` —
Animation/Family/Fantasy — loved by one, hated by the other; `The Dark Knight`
— Action/Crime/Drama — the reverse), `_rebuild_tag_weights` was called for
each exactly as `setRating` does in production, and `recommend_movies` was
called once per user (present alone) against two real theatre candidates with
disjoint genres of their own (`Minions & Monsters`, Animation/Family-leaning;
`DC`, Action/Drama-leaning). The ordering flipped cleanly: the
animation-preferring user's top pick was `Minions & Monsters` (score 1 vs 0),
the action-preferring user's top pick was `DC` (score 1 vs 0, reversed).
**Confirmed, not a documented limitation** — real TMDB genre tags on real
theatre candidates carry enough signal for the scorer to differentiate.

### UI: mode lives in the URL, same as `present`

`app/groups/[id]/night/page.tsx` gained a `mode` searchParam (`home` |
`theatre`, default `home`, so every pre-phase-9 URL still works unchanged).
`components/night-mode-picker.tsx` is a new pair of chips modelled directly on
`present-picker.tsx`'s existing pattern — server-rendered, no client JS, mode
shareable in the URL. `present-picker.tsx` itself gained a `mode` prop so that
toggling presence doesn't silently drop back to home mode (its `hrefFor` now
preserves `mode` alongside `present`); the `NightMode` type lives there rather
than in the new component, since `present-picker.tsx` was already the night
page's URL-state helper file.

Switching mode itself drops `exclude` — the previous three rerolled picks are
no longer the previous three of anything once the candidate pool changes,
exactly the same reasoning `PresentPicker` already applied to presence
changes.

**`p_candidates` is always a real array in the theatre branch, never `null`.**
`NULL` is the function's home/theatre switch, so a cold or empty theatre
region that accidentally passed `null` would silently fall through to the
home-mode group-list pool and render the wrong picks under the Theatre tab —
it would typecheck and show three plausible films while being entirely wrong.
The night page always calls `.map(c => c.movieId)` on the (possibly empty)
theatre candidate array.

`lib/recommend/explain.ts`'s `explain()` gained an optional second parameter,
`releaseLabel`; passing one drops the seen-count line and substitutes the
label. Because the label rides in the existing `reasons: string[]` return,
`NightPickHero` and `MovieCard` needed no changes at all.

### Deferred, deliberately

- **`movie_nights` / `movie_night_attendees` / `watch_confirmations`.** §9's
  phase-9 row stops at "release-status filter." Mode stays transient UI state
  in the URL, same as phase 4 left "who's present."
- **§4.2's widen step** for theatre mode specifically. Already out of scope per
  phase 4's own note; nothing here changes that.
- **A per-title `/movie/{id}/release_dates` call** for finer release-type
  granularity or true region-scoped dates. Not asked for by §4.2, and would
  cost a third TMDB call per candidate.

### Tests

`supabase/tests/rls.test.sql`, now **119** pgTAP assertions (was 113). Six new:
a positive control (D can read the region cache — load-bearing per phase 0's
rule, no negative without one), three negatives pinning `movie_releases`' "no
write policy at all" (`insert`/`update`/`delete` all `42501`), the
`p_candidates` membership guard mirrored from `p_present`, and one proving
`p_candidates` overrides the group-list pool entirely (two freshly-inserted
movies, on no list in the fixture group, both come back — that they appear at
all is what proves the override, not a filter on top of the existing pool).
Fixtures for this block use fresh movie ids rather than the file's earlier
ones: `55555555…` was already imported as D's watched rating earlier in the
same run (phase 8's block), which would have made it an invalid theatre
candidate for D and obscured what the block was actually testing.

### Verification

1. `supabase db reset` → all twelve migrations apply clean. `supabase test db`
   → **119/119**.
2. `pnpm typecheck`, `pnpm lint`, `pnpm build` — clean.
3. `pnpm smoke:theatre` (new) — pass: cold refresh hits TMDB and writes rows
   matching what it returns; a second call inside the TTL makes zero TMDB
   calls; a planted stale/orphaned row is deleted by the next refresh; every
   upcoming row falls inside the 4-week window. See above for what this run
   also incidentally proved about the cap/TTL convergence.
4. The taste-differentiation check above, against real cached data from the
   `smoke:theatre` run.
5. Live browser click-through (Claude-in-Chrome) against a real local
   magic-link session: toggled Home → Theatre, got a real TMDB-cached pick
   with "In cinemas" reasons and no seen-count line, rerolled to a new pick,
   toggled presence off and back on (URL correctly preserved `mode=theatre`
   throughout), toggled back to Home (returned to the unchanged, unrelated
   home pool). No console errors on either a fresh load or a reload with
   console tracking active from the start.
6. Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP, same route as
   phases 0/3/4. `apply_migration` stamped `20260730163534` — which sorts
   **before** `20260730180000_phase8_onboarding_imports.sql`, even though
   phase 8 shipped first, and unlike phases 0/3 (whose remote-assigned
   version landed *between* its neighbors) there was no ordering-safe rename
   available here.

   Renaming the local file to match would have misordered the migrations
   directory relative to true build order. Leaving the mismatch undocumented
   would have been worse than cosmetic: a future `supabase db push` compares
   by *version*, so it would see `20260730190000` as unapplied, attempt to
   re-run it, and fail hard (`create type release_type` already exists,
   `drop function ... recommend_movies(uuid, uuid[], uuid[])` has nothing to
   drop) — the opposite of phase 0's SQL-text mismatch, which stayed inert
   specifically because *its* version matched.

   Fixed at the root instead: the remote's tracking row is metadata, not
   schema, so `supabase_migrations.schema_migrations.version` was updated
   directly from `20260730163534` to `20260730190000` to match the filename —
   no DDL touched, verified by re-selecting the row and confirming the schema
   (`movie_releases` columns/nullability/RLS policy/grants, and
   `recommend_movies` via `pg_get_functiondef`) is unchanged and still
   byte-for-byte identical to local. `supabase migration list` now shows
   phase 9 after phase 8 on both sides, and `20260730190000_phase9_theatre.sql`
   is both the true build-order position and the exact version remote has
   recorded. `supabase db reset` and `supabase test db` (119/119) were
   re-verified against the corrected local ordering.

### Not exercised

`app/groups/[id]/night/page.tsx`'s `regionMismatch` branch (present members
whose regions disagree) was never driven by a real multi-region group — the
browser check above used a single-member group, so the note line rendered zero
times. The logic reads straightforwardly from the present-members' `region`
column, but treat it as unverified rather than implicitly covered by "live
click-through."

## Explore — the trailer feed at `/explore` (post-phase-9 feature)

Migrations:
`supabase/migrations/20260802120000_explore_trailers.sql`,
`supabase/migrations/20260802130000_explore_grants.sql`.

### Why out of band, and how SPEC was amended

Explore is not in SPEC §9's build order (phase 9 is theatre mode; phase 10 is
public profiles). It was approved to build now as a post-phase feature because
Venn had no way to browse films you don't already know the name of — search
needs a query, the list needs a name, the recommender needs a group. SPEC §7
gains screen 12 ("Explore") with an explicit note that it is distinct from
screen 9 "Discover" (the phase-10 people directory), and §9 gains build-order
row 9.5 recording it as a built-out-of-band feature. The spec was amended in
place, not contradicted.

### `trailer_key` and `trailer_fetched_at` are two columns, not one

`trailer_key is null` is ambiguous between "this film has no trailer on the
provider" and "nobody has looked yet". The second column makes the backfill
cheap: it only ever queries rows with `trailer_fetched_at is null`, and stamps
its work even when the answer is null, so trailer-less titles are looked up
once, not on every feed page. This is the same role `fetched_at` plays on
`movie_releases` and on `movies` itself. Since `getMovie` now always asks for
videos, every freshly minted row is stamped at insert; the backfill exists for
rows cached before this feature landed.

### Trailer data rides the detail call; `getTags` stays untouched

`videos` is added via `append_to_response` on the existing detail request —
zero extra HTTP round trips, the same argument phase 9's migration makes about
not paying a third call per candidate. `getTags` was deliberately left alone:
it is a separate call to the same endpoint with its own append list, and it
returns `Tag[]`, which has no room for a trailer key. `getTrailerKey` exists as
the dedicated backfill path for cached titles.

### The YouTube iframe is a new external surface

The Explore card embeds `youtube-nocookie.com` (the privacy domain) in a muted,
autoplaying iframe. This is the repo's first third-party embed. Two rules bound
it: autoplay is muted only, and the IFrame Player API was rejected as an
external script — unmuting therefore remounts the iframe and restarts the
trailer from the top, which is an accepted tradeoff (the sound toggle is a
transport control, and restarting a trailer is not a defect). The IFrame Player
API is the documented upgrade path if resume-on-unmute ever matters.

### The screen and the placard

The card is a projection with a placard under it: blurred backdrop floods the
card with the film's own palette, the sharp 16:9 trailer is the screen, and
every vote control sits below it. Controls never overlay the video — this
app's system is "a dark room, two projector beams, and a screen", and you do
not put buttons on the screen. The blurred backdrop is what makes the black
around a 16:9 video load-bearing rather than dead space; without it the letterbox
would be empty, with it the letterbox is lit by the film's own colour.

### Reduced motion and save-data opt out of autoplay

Both preferences are read on mount (they do not exist during SSR) and suppress
the iframe entirely, showing the sharp poster in the same frame — no layout
shift — with an explicit play button whose tap mounts the same embed. This is
the app's only place where the user's OS-level motion preference changes what
plays automatically.

### Vote semantics are search's, unchanged

`ExploreCardActions` ports `SearchMovieActions`'s state machine wholesale:
same toggle flows (`addToList`/`removeFromList`/`addWatchedToList`/`setWatched`)
and the same watched→rating / unwatched→hype handoff. The one difference is
that the Explore pool is always pre-cached, so `VoteControl` renders
immediately instead of waiting for a list row. `setRating`'s UPDATE-only
behaviour stays safe for the same reason search's is: the rating control only
exists on a watched card, and watched rows are created by `setWatched` or
`addWatchedToList` before the rating can be tapped.

### `explore_grants`: service_role reads for the feed

`exploreFeed` reads the caller's `user_movie_status`, default list, and
`list_items` through the service client — phase 5 granted exactly `select on
lists` and `insert on list_items` for ingest's needs and nothing on
`user_movie_status`, so the feed could not read vote rows ("their absence was a
real bug", in phase 5's own words, happened here again). The second migration
grants SELECT only, on `user_movie_status` and `list_items`, with no REVOKE —
these tables already carry their phase-0 authenticated grants, which the
repo's revoke-then-grant rule (written for new tables) must not disturb. All
user writes — votes, list membership — still go through the authenticated
client and RLS; the service key gains read access to vote rows in the same
trust domain phase 5 already accepted for profiles and lists, and the feed
filters by a user_id that server actions resolve from the session, never from
client input. The smoke script's test vote inserts through the user's own
token-bearing client for the same reason.

### Explore design correction: chrome, the frame, and the placard

A design review found the concept sound (backdrop-lit projection, no controls
over the video) but the execution around it broken: the route's own header had
no padding (the only route to opt out of `<Screen>`, it lost the padding along
with the width cap), the feed's mobile height calc subtracted only the tab bar
or only the header depending on breakpoint when both actually apply on mobile
(`AppHeader` has no `sm:` visibility guard), inactive cards in
`TrailerFrame` rendered nothing until active, the sharp still used the 2:3
`posterUrl` force-cropped into a 16:9 box while the native 16:9 `backdropUrl`
sat unused on the same card, and starting playback flashed black while the
iframe loaded. `TrailerFrame` now renders a still (backdrop preferred, poster
fallback) as a permanent base layer regardless of `active`, with the iframe
layered on top rather than swapped in.

### The placard: votes over list actions

The vote row is Explore's primary action — every card's job is to get voted on
— but the placard rendered five 10px pills of identical weight. `VoteControl`
gained an opt-in `size?: "sm" | "lg"` prop (default `sm`, byte-identical for
its four other callers: `/`, a group page, `/search`, movie detail); Explore
alone passes `lg`, which restores `.t-label`'s real 11px while keeping the
tighter 0.02em tracking that fits "Very hyped" (`vote-control.tsx`'s own
"VoteControl label size" note above — the tracking is the load-bearing part,
not the size). `Add to list` / `Mark watched` demoted from filled pills to a
quiet text row below the votes. The mute toggle moved onto the title line —
it's a transport control, not a vote, and giving it its own row was spending
placard height that the vote row needed more.

Moving mute freed height, but capping the title spends some of it back: the
title previously had no line cap, so a long title could grow past what the
desktop cap (`explore-card.tsx`'s `max-w-[...]`) had reserved for it, and the
section's `overflow-hidden` silently clipped the vote row off the bottom. The
cap's reserved-height constant is now 29.3rem (was 28rem) — net of removing
the mute row (-3.5rem), budgeting the now-permitted 2nd title line (+3.28rem),
the meta/action-block margin changes (-0.5rem / +0.5rem), the `gap-2` →
`gap-3` in `ExploreCardActions` (+0.25rem), and `size="lg"`'s `min-h-12` vote
row (+1.28rem) — documented at the constant's definition site.

**The title is capped with `max-height` + `overflow-hidden`, not
`line-clamp-2`, and this was a real bug caught by rendering, not by reasoning
about it.** `line-clamp-2` was the first attempt; a throwaway route rendering
a real `ExploreCardView` (headless Chrome, since no Claude-in-Chrome extension
was available this session) showed a sliver of the clamped-away 3rd line's
glyph tops bleeding through under line 2. `.t-display`'s line-height is an
intentional 0.82 (poster lettering, see `globals.css`) — tighter than Anton's
own glyph metrics — and `-webkit-line-clamp`'s box-height accounting doesn't
fully hide an extra line under that combination. A plain `max-h-[calc(clamp(32px,9vw,64px)_*_1.64)]
overflow-hidden` on the `h2` doesn't share that failure mode. The cost is no
ellipsis, which matches this app's own existing precedent for a hard-clipped
display title (`night-pick-hero.tsx`: "the section clips it," no ellipsis
there either).

**The 29.3rem figure was re-derived by arithmetic, then verified against a
real render**, for the same reason the line-clamp bug above would otherwise
have gone unnoticed: `overflow-hidden` clipping is silent, so a wrong constant
would not show up as an error, a warning, or a visible scrollbar — just a
vote button quietly missing. The throwaway route (`app/layout-probe`,
`lib/supabase/proxy.ts`'s `PUBLIC_PATHS` temporarily included it, both
reverted after) rendered a real `ExploreCardView` with a hardcoded card behind
the app's real chrome, and headless `google-chrome` (system binary, no new
dependency) measured `card.scrollHeight > card.clientHeight` — the actual
clipping test, since `overflow-hidden` + `justify-center` gives no other
visible signal — across 360–1440px wide, 640–1024px tall, both a long title
("Everything Everywhere All at Once") and a one-line one ("Dune"). No
clipping anywhere, and consistently with room to spare, so 26rem is confirmed
a safe upper bound for the placard term, not merely a computed one. The same
pass confirmed the mobile feed-height fix below (`docOverflow` — document vs.
viewport height — was exactly 0 at every width tested) and that `size="lg"`'s
11px "Very hyped" doesn't wrap at 360px, 388px, or 768px, the widths this
document's "VoteControl label size" entry already names as failure-prone.

---

## Phase 10 — public profiles, follows, visibility toggles, blocks

Migration: `supabase/migrations/20260804120000_phase10_social.sql`.

### Overview & Architecture

Phase 10 widens database read policies from "me or my group peers" to SPEC §3's full read predicate:
- `can_read_list(lid)` functions as the single statement of SPEC §3's list read predicate.
- Public profiles: signed-in users can view any profile, minus blocks.
- List visibility: `public`, `followers`, `private`.
- Symmetric blocks: blocking hides profiles, lists, and follow relationships in both directions and overrides shared group membership.

### Key Decisions & Rationale

- **`can_read_list()` and `is_blocked_with()` are SECURITY DEFINER**:
  1. `can_read_list` queries `lists` while being called from `lists`' own SELECT policy. Definer mode runs as postgres, bypassing RLS on `lists` so the inner query does not re-enter the policy.
  2. `is_blocked_with` checks blocks in both directions. Since `blocks_select_own` only permits reading blocks created by the caller, a policy subquery would miss blocks created *against* the caller. Definer mode enables symmetric block checks without exposing who blocked the caller.
  3. Because cross-table lookups happen inside definer functions, widened policies contain no cross-table subqueries of their own.

- **Write policies did NOT widen**:
  `list_items` insert, update, and delete policies remain strictly scoped to list owners and group members. Following someone or being able to view their public list grants zero write permissions.

- **Profile columns exposed to signed-in non-blocked users**:
  `profiles` SELECT policy allows reading any non-blocked profile. Columns like `region` and `default_list_visibility` are preferences, not secrets; exposing them directly avoids high RPC overhead for every profile or directory query.

- **Blocks beat group membership**:
  If User A blocks User B, neither can view the other's profile or list. On group pages, "added by" for a blocked user gracefully falls back to `"Member"`.

- **`list_hidden_from` ships without UI**:
  `list_hidden_from` table and RLS predicate land in this phase per SPEC §3. Since users currently have a single default list and blocks provide per-user hiding, per-list user exclusion UI is omitted.

- **Single visibility control in Settings**:
  The Settings visibility form updates both `profiles.default_list_visibility` and default `lists.visibility` together.

- **Unscoped `profiles ... .single()` fallout fixed**:
  Three queries in `app/search/actions.ts`, `app/settings/imports/actions.ts`, and `app/api/imports/[id]/process/route.ts` were missing `.eq("id", userId)`. Widening profiles would cause `.single()` to fail silently (falling back to `"IN"`). Scoping them with `userId` resolved this issue.

- **Discover omits groups until Phase 12**:
  `groups.visibility` does not exist yet (deferred to Phase 12 joinable groups). Discover displays user search and public lists.

- **`searchMovies(listId)` note**:
  `app/search/actions.ts` resolves passed `listId` via `.eq("id", listId).maybeSingle()`, which can resolve a followed user's list. Any item insertion still fails due to un-widened write policies.

- **Security Advisor WARNs**:
  Two expected Supabase security advisor warnings exist for `can_read_list` and `is_blocked_with` SECURITY DEFINER functions with empty `search_path`, identical to Phase 3's `is_group_member`.

### Post-review fix: `/discover`'s public-lists embed was ambiguous

A review after the initial commit found `app/discover/page.tsx`'s
`lists.select(…, profiles(username, display_name))` failing every request with
PostgREST's `PGRST201` ("more than one relationship was found for 'lists' and
'profiles'"). `list_hidden_from`, added earlier in this same migration, gives
PostgREST a second path between the two tables — the existing `owner_user_id` FK,
and the new `list_hidden_from` junction (`lists` ← `list_hidden_from` → `profiles`).
Adding a table with two FKs into an existing embed's path is exactly the kind of
thing an embed written before the migration lands has no way to see coming. The
query only destructured `data`, never `error` — the same silent-failure shape the
original phase 10 plan flagged for three `.single()` call sites — so it degraded
to "no public lists" on every load instead of erroring visibly.

Fixed by naming the constraint explicitly, the same disambiguation
`app/settings/page.tsx`'s `blocks` embed already used correctly:
`profiles!lists_owner_user_id_fkey(username, display_name)`. Checked the same
ambiguity does not reach any other embed in the tree — `group_members→profiles`,
`list_items→profiles`, and `blocks→profiles!blocks_blocked_id_fkey` are unaffected,
because `list_hidden_from` only creates a second path between `lists` and
`profiles` specifically. Verified against a live PostgREST instance before and
after: `PGRST201` reproduced pre-fix, a real public list returned post-fix.

The review also added the `update`/`delete` regression negatives the original plan
asked for alongside the existing insert negative ("E, who can read F's list via
follow/public visibility, cannot write to it") — present in the migration's
policies from the start but not pinned by a test. Both are `USING`-clause
policies, so an unauthorized write matches zero rows and returns success rather
than throwing; the assertions confirm the row is untouched (`is()`, not
`throws_ok()`), matching the pattern phase 0 already established for
`profiles_update_own`. `supabase/tests/rls.test.sql` is now **150** assertions
(was 148).

Also restored `app/settings/page.tsx`'s `/inbox` header link, which the initial
commit had replaced with `/discover` instead of adding alongside it — `AppHeader`
only auto-renders an Inbox link when the caller passes `inboxCount`, which
Settings does not, so that was the only path to Inbox from Settings on desktop.


---

## Phase 11 — notification matrix, moderation, analytics, deletion + export, legal pages

Migrations:
- `supabase/migrations/20260805100000_phase11_reports.sql`
- `supabase/migrations/20260805110000_phase11_movie_nights.sql`
- `supabase/migrations/20260805120000_phase11_notifications.sql`

### What changed, and why

- **`push_subscriptions` is a departure from SPEC §3**:
  The table is not present in SPEC §3's initial data model. Web Push delivery requires storing per-device endpoints, p256dh keys, and auth secrets; there is nowhere else for Web Push subscriptions to reside, so `push_subscriptions` was created with `user_id` FK and own-row RLS.

- **Moderation admin identity uses environment allowlist (`ADMIN_USER_IDS`) and not a `profiles.is_admin` column**:
  `profiles_update_own` allows authenticated users to update their own profile fields. Placing an `is_admin` boolean on `profiles` would introduce a self-service privilege escalation vector unless strictly scoped with column-level write grants. Using `ADMIN_USER_IDS` in environment configuration keeps administrative privileges out of the user-writable table.

- **`notification_prefs` has no seeding trigger**:
  Absent rows fall back to SPEC §8 defaults, resolved at runtime in TypeScript (`lib/notifications/categories.ts` → `resolvePrefs`). A DB trigger seeding 5 rows per user would bloat storage unnecessarily; an un-seeded overlay pattern keeps the database lean.

- **Weekly digest is a daily Vercel cron with a weekday check**:
  Vercel Hobby crons operate at day-granularity (`30 3 * * *`). The cron handler (`/api/cron/digest`) checks `new Date().getUTCDay() === 0` to execute only on Sundays (or when explicitly forced via `?force=true` during testing).

- **Account deletion cascades `list_items.added_by`**:
  `list_items` references `profiles(id)` via `added_by` with `ON DELETE CASCADE`. Deleting a user account cascades deletion to their added items across all lists, including group lists. This was accepted deliberately as account deletion represents a complete removal of user contributions.

- **Data export uses the user-scoped client**:
  `/api/export` uses `createClient()`. Because RLS policies enforce single-user access control across all target tables, using the user-scoped client allows RLS to filter the exported data without manual `.eq("user_id", ...)` clauses, preventing over-fetching or cross-tenant leaks.

- **`reports.target_id` carries no foreign key**:
  The report table supports reporting users, lists, and list items (`target_type IN ('user', 'list', 'list_item')`). Because `target_id` is polymorphic across three different tables, a traditional foreign key constraint cannot be applied.

- **`service_role` grants per migration** (corrected below to match what each
  migration actually grants — an earlier version of this entry claimed grants
  that were never written, on `list_items` and `movie_night_attendees` /
  `watch_confirmations` in particular; a decisions log that misstates the
  schema is worse than none):
  - `20260805100000_phase11_reports.sql`: `GRANT SELECT, UPDATE ON reports`, `GRANT SELECT ON profiles`, `GRANT SELECT, UPDATE ON lists`, `GRANT SELECT, DELETE ON list_items` — `/moderation` reads and actions reports, names the reporter/target, and can blank an abusive list name or delete a reported item.
  - `20260805110000_phase11_movie_nights.sql`: `GRANT SELECT ON movie_nights, movie_night_attendees` — the digest cron reads both. Nothing is granted on `watch_confirmations`; nothing server-side needs it.
  - `20260805120000_phase11_notifications.sql`: `GRANT SELECT ON notification_prefs`, `GRANT SELECT, DELETE ON push_subscriptions` (the `DELETE` is what lets `sendPush()` auto-prune a subscription on HTTP 404/410), `GRANT SELECT ON follows` — the digest cron walks follow edges.
  - `20260805140000_phase11_digest_grants.sql` (added on review, see below): `GRANT SELECT ON groups, group_members` — phase 3 granted both to `authenticated` only; the digest cron runs as `service_role` and had no privilege on either table until this migration. `explore_grants.sql` is the precedent for this exact gap.

- **Weekly digest resolves email addresses through `auth.admin.getUserById` / `listUsers()`**:
  SPEC §3 `profiles` table contains no `email` column, and PostgREST does not expose Supabase's internal `auth` schema. The digest cron uses `createServiceClient().auth.admin` to resolve verified user email addresses safely.

- **Environment variables and `NEXT_PUBLIC_` scoping**:
  - `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`: Client-facing write-only / public identification keys, placed in `NEXT_PUBLIC_` by design.
  - `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `RESEND_API_KEY`, `CRON_SECRET`, `ADMIN_USER_IDS`: Secret server-side configurations, kept private from client bundles.

- **RLS test suite updated**:
  `supabase/tests/rls.test.sql` plan updated to **172** assertions (from 150), covering positive and negative RLS controls for `reports`, `movie_nights`, `movie_night_attendees`, `watch_confirmations`, `notification_prefs`, and `push_subscriptions`.

### Post-review fixes

A review after the initial commit found seven defects, none caught by `pnpm
build`/`lint`/`typecheck` — all either runtime permission errors, silent no-ops, or a
live data-loss path. Fixed in two follow-up migrations plus application-code changes on
the same branch:

- **`reports.target_id` alone could not name a `list_item`** (`list_items`' primary key
  is `(list_id, movie_id)`, not a single column), and
  `app/moderation/actions.ts`'s `deleteReportedContent` deleted by `list_id` only —
  actioning one reported note removed every item in the list. Both report buttons
  (`app/groups/[id]/page.tsx`, `app/movies/[id]/page.tsx`) were passing a list id as
  `target_id` with no way to say which item. Fixed by
  `20260805130000_phase11_report_target_fix.sql`: adds `target_movie_id` (nullable,
  `on delete set null`, required by a check constraint exactly when
  `target_type = 'list_item'`), and widens the one-report-per-target unique index to the
  full `(reporter_id, target_type, target_id, target_movie_id)` with `nulls not
  distinct` — without that clause the index stops deduplicating `user`/`list` reports,
  since Postgres treats every `NULL` as distinct from every other `NULL`. The delete now
  scopes by both `list_id` and `movie_id`, and refuses to run if `target_movie_id` is
  missing.

  Noted, not changed, while reading this action: for a `user`-target report,
  `deleteReportedContent` overwrites `profiles.display_name` to `"Removed"` — a real
  action, not just a `reports.status` change, and not previously written down anywhere.
  This mirrors the existing `list`-target behaviour (blanking `lists.name` to
  `"Removed"`), and is deliberately the *lighter* of the two `user`-target actions —
  `deleteReportedAccount` is the other, and actually removes the account. Left as-is:
  it's a defensible lighter-touch moderation action for an abusive display name that
  doesn't warrant deleting the whole account. Recorded here because it has no audit
  trail and sends the affected user no notice, which a future phase may want to revisit.

- **The digest cron had no `service_role` privilege on `groups` or `group_members`.**
  Phase 3's `revoke all on groups, group_members from anon, authenticated,
  service_role` granted `SELECT` back to `authenticated` only; no later migration
  (including this phase's own) granted either table to `service_role`, and
  `app/api/cron/digest/route.ts` runs as `createServiceClient()`. Both queries failed
  with `permission denied`, and because the route only destructured `data` and never
  `error`, the movie-nights section silently vanished from every digest instead of
  erroring. Fixed by `20260805140000_phase11_digest_grants.sql`
  (`grant select on groups, group_members to service_role;`) and by checking `error` on
  both queries in the route, so the next missing grant is loud instead of silent.

- **`friend_added` defaulted to `email: false`, and the digest gated its own section on
  that same flag** — SPEC §8 marks that category **"digest only"**, meaning the digest
  is its delivery channel, so the default should have been the opposite. Combined with
  the grant gap above, both sections of the digest were empty for every user and the
  route returned `{ ok: true, sentCount: 0 }` — success-shaped, doing nothing. Fixed in
  `lib/notifications/categories.ts`: `friend_added.email` now defaults to `true` (push
  stays `false`, per §8's explicit warning against defaulting that one to push).

- **`/api/export` returned other users' data.** `profiles` had no `.eq("id", userId)` —
  the same unscoped-`.single()` shape phase 10's review already found and fixed in three
  other files, now reintroduced in a fourth. `lists`, `group_members`, and
  `movie_night_attendees` had no owner filter at all: their SELECT policies are read
  predicates (a public list, a followers-visible list, a co-attendee's membership row),
  not ownership filters, so the export shipped other people's list contents and other
  group members' roles in a file framed as "your data." Fixed by adding an explicit
  `.eq(..., userId)` (or the equivalent) to all four queries — RLS remains the security
  boundary, but is not treated as an ownership filter here. `follows` was also split into
  separate `following`/`followers` keys, since one unfiltered query returned both
  directions merged into a single ambiguous list.

- **Deleting an account left the browser in an onboarding loop.** `deleteAccount` called
  `service.auth.admin.deleteUser(userId)` but never `supabase.auth.signOut()` on the
  user-scoped client. `getClaims()` verifies JWT signature against the project JWKS and
  does not check whether the user still exists, so a deleted user's token stayed
  "valid" until it expired; the next navigation found valid claims, a `profiles` query
  that returned nothing, and `proxy.ts` redirected to `/onboarding`, which cannot
  complete because `handle_new_user` never fires for a user that no longer exists. Fixed
  by calling `supabase.auth.signOut()` before `deleteUser()`, matching the order
  `app/auth/signout/route.ts` already uses for a normal logout.

- **The digest emailed raw HTML.** Group names and display names are free text (SPEC
  §11 names free-text fields as exactly where abuse appears), and were interpolated
  directly into the digest's email template. Fixed with a local `escapeHtml()` applied
  at every interpolation site. `listUsers()` was also unpaginated (Supabase defaults to
  50 per page) and would have silently stopped reaching recipients past the first 50;
  fixed by looping pages until a short page ends the loop.

- **`sendPush()` / `captureServer()` were called without `await`** at several sites
  (`app/follows/actions.ts`, `app/groups/[id]/night/actions.ts`,
  `app/status/actions.ts`, `app/list/actions.ts`, `app/onboarding/actions.ts`,
  `app/api/imports/[id]/process/route.ts`). In a serverless function the response can
  return, and the runtime may recycle, before an un-awaited promise's underlying `fetch`
  completes — a gap invisible in a long-lived local `pnpm dev` process. Fixed by
  awaiting each call, collecting per-loop sends into `Promise.all(...)` where there were
  multiple recipients. `app/api/ingest/route.ts` and `app/share/route.ts` already used
  Next's `after()` for exactly this problem on `resolveInBackground`; `captureServer`
  moved inside the same `after()` callback rather than being awaited before the
  response, since SPEC §5 requires returning 200 immediately.

Also removed `components/posthog-provider.tsx`, an unused component from a superseded
approach — `app/layout.tsx` renders `components/analytics.tsx` instead.

`supabase/tests/rls.test.sql` gained four assertions for the `target_movie_id` fix — the
check constraint rejects a `list_item` report without it, a `list_item` report with it
succeeds, a second report on a *different* movie in the same list is no longer treated
as a duplicate (the bug), and a true duplicate on the same list-and-movie pair is still
caught by the widened unique index. **176** assertions total (was 172 after the initial
phase-11 commit, 150 before phase 11).

Migrations: `20260805130000_phase11_report_target_fix.sql`,
`20260805140000_phase11_digest_grants.sql`.

---

## Phase 12 — hype-vs-reality stats, joinable groups, monetization

Migrations: `supabase/migrations/20260805150000_phase12_hype_history.sql`, `supabase/migrations/20260805160000_phase12_joinable_groups.sql`.

### Hype History & Stats

- **Trigger on `user_movie_status` owns `hype_history` writes**, rather than `app/status/actions.ts`. `setWatched()` in `app/status/actions.ts` clears `hype` and `rating` together, and `setRating()` sets the rating in a second statement. A trigger sees all status state changes across all write paths, including onboarding (`app/onboarding/actions.ts`), import processing (`app/api/imports/[id]/process/route.ts`), and ingest processing, which bypass server actions entirely.
- **`tg_op` branching in trigger**: Onboarding (10 ratings) and import processing write ratings via `INSERT`. `old` is unassigned on `INSERT`, so `tg_op = 'UPDATE'` branching prevents plpgsql runtime errors on `old.rating`.
- **One open prediction per (user, movie)**, enforced structurally by partial unique index `hype_history_one_open_idx (user_id, movie_id) WHERE resolved_rating IS NULL`. Re-hyping a title before watching replaces the open prediction row rather than appending a second one.
- **Resolution targets the most recent row for the pair**, rather than restricting updates to `WHERE resolved_rating IS NULL`. If a user rates `like` and later changes it to `love`, history updates the existing resolved row so that `/stats` does not contradict what their own list shows. Rating a film that was never hyped creates no row — that is not a hype prediction data point.
- **Grants & RLS**: `authenticated` receives `SELECT` only; the `SECURITY DEFINER` trigger is the sole write path. RLS policy `hype_history_select_own` scopes reads to `(select auth.uid()) = user_id`.
- **Backfill**: The migration backfills open predictions from live `user_movie_status` rows where `hype IS NOT NULL`. Resolved predictions cannot be backfilled because `setWatched()` previously cleared hype when watched flipped. Stats are therefore forward-looking from this migration onward.

### Joinable Groups

- **`groups` SELECT policy was NOT widened.** Phase 3's comment established that exposing `invite_code` to non-members defeats the invite mechanism. Widening `groups_select_member` would leak `invite_code` to all users, even if an owner flips a group back to invite-only. Instead, public groups directory browsing is served via `public_groups(p_limit int)` — a `SECURITY DEFINER` function returning `(id, name, member_count, created_at)` without exposing `invite_code`.
- **Instant Join**: `join_public_group(p_group_id uuid)` is a `SECURITY DEFINER` function that validates `visibility = 'public'`, inserts a `group_members` row for `auth.uid()`, and returns the group ID.
- **Owner Visibility Control**: `set_group_visibility(p_group_id uuid, p_visibility group_visibility)` is a `SECURITY DEFINER` function updating `groups.visibility` where `created_by = auth.uid()`. This avoids granting table-level `UPDATE` on `groups`, keeping group renaming out of scope as decided in Phase 3.

### Monetization

- **Ad Slots**: Gated by `NEXT_PUBLIC_ADS_ENABLED` in `lib/ads.ts` (unset/false by default). Component `AdSlot` renders a dashed house placeholder box ("Advertisement") when enabled, and `null` when disabled.
- **Strict Placements**: Exactly four placements in list views (`my-list-top`, `my-list-bottom`, `group-list-top`, `group-list-bottom`). Rendered strictly outside poster grid elements. Never in the picker, `/explore`, `/movies/[id]`, `/onboarding`, or legal pages.
- **Pre-revenue Checklist**: Before `NEXT_PUBLIC_ADS_ENABLED` is ever set to `true` in production:
  1. Upgrade to TMDB commercial developer key (~$149/mo).
  2. Upgrade Vercel account to Pro tier (~$20/mo).
  3. Update `/privacy` to outline ad disclosure and network partners.
  4. Send confirmation email to TMDB as required by SPEC §2.

### Deliberately Deferred

- No ad impression/click analytics event (speculative until an ad network integration exists).
- No group-level or cross-user stats (personal-only scope; `user_movie_status` remains strictly closed).
- No join-request or owner approval queue (instant join keeps interaction lightweight).
- The public groups directory is not filtered by `blocks` (a group contains multiple members; blocking one member should not hide an entire group).
- No non-member preview page for public groups (instant join makes preview redundant).

### Explore Scroll-Past Disinterest & Recommender Weighting

- **`scrolled_past_at` Column**: Added `scrolled_past_at timestamptz` to `user_movie_status` (`supabase/migrations/20260805170000_explore_scroll_past.sql`).
- **Explicit "Meh" (0.25) vs Implicit Scroll-Past (0.1)**:
  - An explicit click on the "Meh" button sets `hype = 'dont_care'`, which scores `0.25` in the recommender algorithm (§4.3 step 3).
  - Scrolling past a card in `/explore` without voting sets `scrolled_past_at = now()`, leaving `hype` and `rating` `null`. In `recommend_movies`, `scrolled_past_at is not null` receives a lower score (`0.1`), reflecting that the user didn't even bother voting for it.
- **Feed Paging & Tiered Ordering**: `exploreFeed` in `lib/movies/explore.ts` filters out hard exclusions (`watched`, `rating != null`, `hype != null`) completely, while placing soft-disinterested (`scrolled_past_at != null`) titles at the tail of the release pool after all fresh unseen titles (`[...freshReleaseIds, ...scrolledReleaseIds]`). Fresh titles always load first on `/explore`, while scrolled-past titles remain in the candidate pool as overflow rather than being permanently hard-excluded.

### Onboarding rating minimum lowered from ten to five

Ten ratings before "Enter Venn" appeared was too long a wall on a first-run
screen. The minimum is now five, enforced the same way phase 8 designed it:
`complete_onboarding()` (`supabase/migrations/20260808000000_onboarding_five_rating_minimum.sql`)
still checks the count inside one `SECURITY DEFINER` function, still rebuilds
tag weights, and `onboarded_at` is still not client-writable. Only the
threshold changed, from `< 10` to `< 5`.

Voting past five is unbounded and purely opt-in — the "Load more movies" flow
already paged through popular titles, so nothing there needed to change.
`OnboardingTaste` mounts the "Enter Venn" button as soon as the count reaches
five and leaves it mounted; the user can keep rating with the button on
screen, or leave. The progress readout drops its `/ 5` denominator once the
minimum is met, since a running count with no ceiling has no denominator to
show. Hype votes on unreleased titles still don't count toward the minimum
(§4.5: only ratings feed `user_tag_weights`), and pre-existing ratings from
library imports still count, unchanged from phase 8.

---

## SPEC §4.2's widen step, built out of band against phase 4

Not a new phase — this fills a gap phase 4 left open on purpose and phase 9
repeated for theatre mode. Phase 4's own migration
(`20260726154439_phase4_recommender.sql:25-27`) named the widen step and
deferred it explicitly: "it needs a new `MovieDataProvider` method and a
`cacheMovie` per pulled title. The picker returns fewer than 3 instead." That
degraded behaviour — the night page falling to "Everything on the group list
has been seen by someone here" — is what a 4–6 person group hits within
weeks of using the picker at all, since the app has no other source of new
candidates. Migration: `20260809120000_widen_candidate_pool.sql`.

**Scope: home mode only.** Theatre mode's widen stays out of scope, per phase
9's own note — nothing here changes that.

### Why a new SECURITY DEFINER function, not a page-side count

The trigger condition is "fewer than ~10 candidates," where a candidate is a
group-list movie minus anything a *present* member has watched. Phase 3 left
`user_movie_status` strictly closed under RLS, and phase 12's `hype_history`
entry reaffirmed that boundary — a member cannot read another present
member's watched rows to compute that count client-side. Seed selection has
the identical problem: it reads present members' ratings. So `widen_seeds`
is `SECURITY DEFINER`, exactly like `recommend_movies`, and repeats both of
its guards verbatim (`is_group_member`, and every `p_present` id must belong
to the group) — a function reading other members' private rows must not be
callable for a group the caller isn't in, or with a smuggled-in stranger's id.

### `recommend_movies` was not touched

Phase 9's `p_candidates` parameter is reused as-is: the night page reads the
group's list pool, appends `widen_seeds`' pool of extra movie ids to it in
TypeScript when the count is thin, and passes the union through
`p_candidates`. Widened picks are therefore scored by the exact same
function and the exact same weights as list picks — the only difference is
provenance, which `lib/recommend/explain.ts` surfaces as a new "Not on your
lists yet" line.

**This makes the group-list read load-bearing for correctness, not just for
the label.** When `p_candidates` is non-null, `recommend_movies`'s `pool` CTE
takes the `unnest` branch and never reads `list_items` at all
(`20260805170000_explore_scroll_past.sql:60-70`) — so the TypeScript-side
`poolIds` read in `app/groups/[id]/night/page.tsx` has to be the *complete*
list, or a partial read silently shrinks the non-widened half of the same
feature. It reads unbounded, relying on `supabase/config.toml`'s
`max_rows = 1000` being far past anything a 4–6 person group's list will
hold — SPEC's own stated scale ("Path: private build for 4–6 friends" in
its intro block).

The read also has to be RLS-*equivalent* to what `recommend_movies` would see
under `p_candidates = null`, not merely complete for a given user — a gap
there would silently shrink the pool the same way a truncated read would.
Checked against `can_read_list` (`20260804120000_phase10_social.sql:87-118`):
its group-owned branch is `is_group_member(owner_group_id)` alone, with no
`list_hidden_from` or `blocks` term — those apply only to its third branch,
personal lists shared by visibility. So a group member's RLS-visible view of
their own group's `list_items` is identical to the definer-side read, and
stays that way unless a future phase adds a hide/block term to the
group-owned branch specifically.

### The seed rule

§4.2 says "seeded by the group's top-rated films." Read at face value: films
already on the group's own list, ranked by present members' ratings on them,
using §4.1's own weights (`love +3`, `like +1`, `hate −2`), summed, kept only
when positive, top 3. The weights are re-stated in `widen_seeds` rather than
factored out of `_rebuild_tag_weights` — that function scores (rating, tag)
pairs and this scores rating alone; there's no shared shape to extract.

**Deliberately deferred:** seeding from present members' ratings on films
*outside* the group list. §4.2's wording supports only the list-seeded
reading; a wider seed source is a real design question (which films, how
many, whose ratings count) that the spec doesn't answer and this migration
doesn't need to answer to close the gap it targets.

A seed can be a movie a present member has already watched (a rating implies
`watched = true`) even though it can never be a `candidates` row itself —
that's expected: a highly-rated group-list film is exactly the kind of thing
someone rated *because* they watched it, and it's still a legitimate seed for
"what's like the thing we loved."

### `MovieDataProvider.recommendations`

`lib/providers/tmdb.ts` implements it against
`/{movie,tv}/{id}/recommendations`, dispatched by `parseExternalId` exactly
like every other externalId-scoped method in that file. Seeds are group-list
films, movie-shaped in practice, but the TV branch costs three lines and
avoids a media-type trap the first time a TV title lands on a personal list
and somehow reaches this path. `docs/SPEC.md` §2's interface block gained
one line for it; the rest of that block was already stale (`popular`,
`regions`, `getTrailerKey`, `getExternalIds` are all missing from it) and was
deliberately left alone — not this change's job to fix.

### The label

`lib/recommend/explain.ts` gained a second optional parameter, `notOnLists`,
rather than reusing or renaming `releaseLabel`. That parameter's own doc
comment justifies it as a property of the candidate's `movie_releases` row;
collapsing "came from theatre release data" and "came from the widen step"
into one slot would contradict that and is also simply wrong in principle —
theatre mode never widens, but nothing stops a future dimension from needing
both facts on the same pick. The existing "Nobody here has seen it" line is
untouched and still fires alongside `notOnLists` when true: unlike theatre
mode, where every release-mode candidate is unwatched by construction (phase
9's note on why that line is redundant there), a widened title is excluded
from `candidates` only for *present* members having watched it — a non-present
member may genuinely not have seen it, so the line still carries information.

### Deliberately deferred: no cache on the widen step's TMDB calls

Unlike `theatreCandidates` (`lib/movies/theatre.ts`, TTL-cached per region) and
`exploreFeed`'s trailer backfill, `widenCandidates` calls
`provider.recommendations` fresh on every home-mode render and every reroll
where the pool is thin — up to 3 parallel calls, since seeds come from
`widen_seeds`' top 3. No cache table backs it. This was a deliberate
omission, not an oversight: `movie_releases`' cache key is a region, which is
stable and shared across every group; a widen cache's natural key would be
the group's seed set, which changes on every rating change from any present
member and has no useful TTL — inventing one is exactly the kind of
unrequested configurability CLAUDE.md §2 argues against, for a feature that
only fires once a group's list has thinned out. The upgrade path, if this
ever shows up in page latency the way `cd16895` shows this repo actively
watches for: a `widen_cache(group_id, seeds_hash, movie_ids, fetched_at)`
table keyed on a hash of the sorted seed external ids, TTL'd the same way
`movie_releases` is.

### Tests

`supabase/tests/rls.test.sql`: four new assertions on `widen_seeds`, appended
to the existing recommender block (still-impersonated-D), `plan(194)` →
`plan(198)`. Positive control first, per this file's own house rule: the
candidate count matches what the adjacent `recommend_movies` assertions
already proved for the same fixture state, then the seed-ordering assertion
(a second, higher-scored group-list film, chosen so insertion order and
score order disagree — 33333333 was inserted first but scores lower), then
the two negatives mirroring `recommend_movies`'s own guards. The fixture
inserts (`movies`, `movie_external_ids`) needed a `reset role` /
`set local role authenticated` bracket, same idiom the file already uses
elsewhere, since those catalog tables have no INSERT grant for
`authenticated`.

`scripts/tmdb-smoke.ts` gained a `recommendations` section between
`getImageUrl` and the landed-rows check, asserting Inception returns a
non-empty, correctly-prefixed result set against the live API.

## SPEC §4.5's "None of these" logging, closed the same way §4.2 was

Also not a new phase. §4.5 lists four edge cases; three were built, and the
fourth — "None of these: log it — useful signal" — was deferred from phase 4
to phase 11 as analytics (this file, phase 4 entry), then still missing at
the end of phase 11 (this file, phase 11 entry). Nothing ever read that
deferral again. Migration: `20260809130000_none_of_these_log.sql`.

Before this, `/groups/[id]/night`'s Reroll control
(`app/groups/[id]/night/page.tsx`) appended the three shown picks to the URL's
`exclude` param and re-rendered — a real UI action with no record of it ever
having happened. That's a real loss: a rejected Top 3 is the only *pick-level*
negative signal the recommender ever produces. `hate` ratings and scroll-past
(phase 9.5) are both about individual titles, not about a specific group of
three the recommender chose together.

### One control, not two

§4.5's reroll bullet is the mechanic; the none-of-these bullet is the
logging — they describe one act by the group, not two. So Reroll was
relabelled "None of these" rather than sitting beside a second, near-identical
button. It still does exactly what Reroll did (append the shown picks to
`exclude`, re-render), plus the write.

### Table shape

One row per rejected movie, not a `uuid[]` of three — `group by movie_id`
becomes a real query later, and `movie_id` can be a real foreign key. Unlike
`movie_nights.picked_movie_id` (`set null`, so a night record survives a
catalog deletion), `night_rejections.movie_id` cascades: here the movie *is*
the record, and a rejection with no movie says nothing. No unique constraint
either — rejecting the same title three Fridays running is stronger signal
than rejecting it once, and a log has to let repetition survive, not
collapse it.

Grants follow `reports` (`20260805100000_phase11_reports.sql`), the closest
existing shape — an append-only log written by the user it belongs to:
`select, insert` only, explicitly no `update`/`delete`, REVOKE-then-GRANT per
CLAUDE.md. No `service_role` grant: nothing server-side reads this table, and
the operator reads it as `postgres`, which bypasses both gates anyway.

RLS is insert-own-into-a-group-you're-in, select-own:
`night_rejections_insert_own`'s `is_group_member` check is load-bearing on
its own, not just `user_id = auth.uid()` — without it, a user could log
rejections into a group they aren't a member of and poison that group's
signal with no way for the members to see it happened. Select is **select-own**,
not select-member — the `reports_select_own` precedent, and the same reasoning
phase 12 already applied to `user_movie_status`: nothing in the app reads
this table today, so the narrower policy costs nothing now and, if a reader
is ever added, whoever adds it decides then whether it should be group-wide.

### Write-only is the intended end state, not a placeholder

Rows land and nothing surfaces them, decided explicitly rather than assumed.
"Log it — useful signal" is satisfied by writing a queryable table; feeding
rejections back into `recommend_movies`' scoring would be a real change to
§4.3 the spec doesn't ask for, and surfacing rejected titles in the group UI
is surface area the spec doesn't specify either. Read it with SQL when it's
wanted.

### The action never blocks the reroll

`noneOfThese` (`app/groups/[id]/night/actions.ts`) swallows its own insert
error and returns `{ ok: false }` rather than throwing — analytics must not
break the one control that gets a group to a pick, the same reflex
`widenCandidates` (§4.2) uses for provider failures. It also caps
`movieIds.slice(0, 3)` before inserting: `recommend_movies` only ever returns
top 3, but a server action is a public authenticated endpoint and nothing
else bounds the array's length.

### No `redirect()` in the action; navigation is client-side

Every `redirect()` in this repo is reached from `<form action={formAction}>`
+ `useActionState` (`app/groups/actions.ts`, `app/onboarding/actions.ts`).
There's no precedent here for redirecting out of a bare `startTransition`
call, and `components/none-of-these-button.tsx` doesn't need one: it holds
`rerollHref` (already computed server-side, identical to what old Reroll
used) and calls `router.push` itself once the insert settles, success or not.
That also means `rerollHref` never crosses into the server action's
arguments, so there's no client-supplied redirect target to guard against.
`isPending` stays true through the `router.push`, so the pending affordance
survives losing `LinkPending` (`components/ui/link-pending.tsx`), which only
wraps `<Link>`.

### Known trade-off: reroll now requires JS

`components/present-picker.tsx`'s own comment explains why this page's URL
state is deliberately server-rendered `Link`s — no client JS required to
change who's present or switch modes. `NoneOfThese` breaks that for reroll
specifically, the same way `LogNightButton` already requires JS for "We're
watching this" on this exact screen. "Start over" stays a plain `Link` next
to it, so the page as a whole doesn't become JS-only, but the departure for
reroll itself is real and worth recording rather than leaving implicit.

### Tests

`supabase/tests/rls.test.sql`: six new assertions appended after the
`widen_seeds` block (still-impersonated-D from that block), `plan(198)` →
`plan(204)`. Positive controls first, per the file's own house rule, and
split into two rather than one: the insert is wrapped in `lives_ok` rather
than asserted only as a side effect of a later `select`, because a bare
insert statement here would abort the whole file — not just fail one
assertion — if `night_rejections_insert_own`'s `with check` were wrong,
taking the other 203 results and the diagnosis down with it. Then: D reads
their own row back (control for the select policy); non-member A inserting
for the group throws `42501`; C inserting a row under D's `user_id` throws
`42501`; D's row is invisible to C even though C shares the group (proves
select-own, not select-member); D's own `delete` on their own row throws
`42501` (proves the no-delete grant — `reports_select_own`'s table never
actually asserts this for its own no-mutation claim, so it's worth checking
here explicitly).

### Verified end to end against real infrastructure

Same standard as §4.2: a real Supabase user (GoTrue admin API), a real
password-grant session injected into a real Chrome tab via
`@supabase/ssr`'s `createBrowserClient().auth.setSession()` (which writes the
correct `sb-<ref>-auth-token` cookie itself, rather than hand-deriving its
format), a real group/list/movie scenario, and a real click through the
rendered page. Confirmed: the button reads "None of these", not "Reroll";
clicking it produces the same `?exclude=` URL old Reroll produced and
re-renders correctly (including falling through to the correct empty state
when that was the only candidate); exactly one row lands in
`night_rejections`, correctly attributed to the group, user, movie, and
`mode = 'home'`; "Start over" still clears `exclude` via a plain `Link` and
writes nothing.

## SPEC §4.5's remote-night lobby, the last edge case, closed the same way

Also not a new phase. §4.5's fourth and final bullet: "Remote nights: a lobby
with a join link; `movie_night_attendees` fills as people join." Migration:
`20260809140000_remote_night_lobby.sql`.

Before this, `movie_nights` had no lifecycle: `log_movie_night` inserted the
night and its attendees in the same statement (phase 11), so a night record
only ever existed *after* a pick was made. The spec's own wording rules that
out for a remote night — "attendees fills as people join" only means
something if the row exists before the pick, since `movie_night_attendees`
FKs to `movie_nights`. So this isn't a lobby bolted on beside the existing
flow; it's `movie_nights` gaining an open/closed state, and everything else
(the recommender, logging, reroll, "None of these") runs unmodified against
whichever state it's in.

**Assumption, not asked:** only existing group members can join. Every policy
here is `is_group_member`-scoped, and `movie_night_attendees.user_id`
references `profiles` directly — there's no invite-code layer like
`join_group_by_code`'s. A remote night is the same group in different rooms,
so the join link is just the lobby's own URL.

### `closed_at`, not `picked_movie_id is null`, is the open/closed marker

`picked_movie_id` is `on delete set null` (phase 11) specifically so a night
record survives its movie being deleted from the catalog later — which means
null is already overloaded to mean "no longer has a movie," and can't also
mean "hasn't picked one yet" without collapsing two different states into
one. `closed_at timestamptz` is unambiguous: null while the lobby is open,
stamped the moment a pick closes it.

Added with `default now()` rather than nullable-with-no-default, and that
default is doing real work: every existing insert path —
`log_movie_night`, and the phase 11 pgTAP fixture — is column-listed and
never mentions `closed_at`, so they all land closed automatically. That's
what let `log_movie_night` itself stay completely unchanged. A backfill
`update ... set closed_at = held_at` runs once in the migration for honesty
on a hosted database with real prior rows; it's a no-op locally, where the
column doesn't exist until the rows do.

A partial unique index, `on movie_nights (group_id) where closed_at is
null`, caps a group at one open lobby. That's also what makes
`open_movie_night` idempotent: rather than let two people tapping "Start a
remote night" within the same second race the index and one of them get a
constraint violation, the function checks for an existing open row first and
returns its id. Two people opening a lobby at once is the ordinary case for
this feature, not an error condition.

### Three `security definer` functions, no new tables

`open_movie_night(p_group_id, p_mode)`, `join_movie_night(p_night_id)`,
`close_movie_night(p_night_id, p_movie_id, p_mode)` — same shape as
`log_movie_night` / `request_watch_confirmations` from phase 11:
`security definer`, `set search_path = ''`, `revoke execute ... from public,
anon` then `grant execute ... to authenticated`, `42501` on any authz
failure. They have to be `security definer`: `movie_night_attendees` carries
`grant select` only, no INSERT grant and no INSERT policy — that absence is
the enforcement, same as `group_members` in phase 3, and a plain client
insert was never going to be an option.

- `open_movie_night` requires `is_group_member`; hands back the existing open
  lobby's id if there is one (see above); otherwise inserts the night with
  `closed_at => null` and adds the caller as its first attendee in the same
  call.
- `join_movie_night` requires `is_group_member` of the night's group *and*
  `closed_at is null`, then inserts the attendee `on conflict do nothing`.
  The `closed_at` check matters on its own: attendance on a *closed* night is
  a watch claim (it's what §8's `request_watch_confirmations` fires
  against), so a late arrival can't attach themselves to a pick they never
  saw made.
- `close_movie_night` requires the caller to already be an attendee (the
  same check `request_watch_confirmations` makes) and the night to still be
  open, then sets `picked_movie_id`, `mode`, and `closed_at = now()`.
  Deliberately does not touch `movie_night_attendees` — attendees joined
  themselves, and rewriting the roster at close time would undo the one
  thing this feature was built to capture.

`p_mode` is passed to `close_movie_night`, not fixed at open time, so the
URL's own `?mode=` stays authoritative for the whole time the lobby is open
and `NightModePicker` needs no lobby-specific branch.

No new tables means no new grants and no new RLS policies:
`movie_nights_select_member` and `movie_night_attendees_select_member`
(phase 11) already cover reading an open lobby and its roster — a lobby is
just a `movie_nights` row like any other, at an earlier point in its life.

### `logNight` gains an optional `nightId`; `log_movie_night` itself doesn't change

`app/groups/[id]/night/actions.ts`'s `logNight` takes a trailing optional
`nightId?: string`. When present, it calls `close_movie_night` instead of
`log_movie_night` — closing the lobby's own row rather than inserting a
second one. Without this branch, every remote night would leave two
`movie_nights` rows behind: the open lobby (now stuck open forever, since
nothing ever closes it) and a fresh one from `log_movie_night`, silently
double-counting in the digest and in §10's watch-history stats. The push
notification block after the RPC call is untouched and shared by both
branches — a remote night's attendees get the same "movie night invite" push
a co-located one's do.

### Attendees replace `?present=` as the source of truth; `PresentPicker` disappears

`app/groups/[id]/night/page.tsx` reads `?night=`, and when it names an open
night, `present` is computed from that night's attendees (intersected with
real `memberIds`) instead of from `parsePresent(rawPresent, memberIds)`.
`PresentPicker` isn't rendered in that state at all — `NightLobby`
(`components/night-lobby.tsx`) takes its place. Attendance and `?present=`
can't both be the source of truth for who's here: a member toggling a chip
in a remote lobby wouldn't do anything meaningful (they can't toggle
presence on someone in another house), and would silently desync the picker
from the actual roster if it were left in.

A `?night=` naming a night whose `closed_at` is already set (a stale or
reloaded link) is treated as if the param weren't there at all, not as an
error and not as a frozen "here's what got picked" view — there is no
requirement for the latter, and treating it as absent means the page falls
back to its ordinary present/exclude behavior with no extra branch. The
lobby URL going stale after a pick is expected, not a bug to route around.

### Discovery: one query, one control

The non-lobby branch runs one extra query — a group's open lobby, if any,
plus a `count` on its attendees — feeding `StartRemoteNight`
(`components/night-lobby.tsx`), which renders either "Start a remote night"
or "`<name>` started a remote night · N here" with a "Join the lobby" link.
Without this, the feature would only be reachable by whoever has the link,
which defeats a "join link" that nobody already in the room knows to ask
for.

### Joining is always an explicit tap, never automatic on page load

Opening the lobby URL shows the roster and an "I'm in" button; it does not
call `join_movie_night` on render. Attendance is what §8's watch
confirmations fire against, so auto-joining a member who only opened the
link to see who else was there would later ask them to confirm they watched
something they never actually watched. One tap removes that failure mode
entirely rather than trying to detect or correct it after the fact.

### Polling, not Realtime

`components/night-lobby.tsx`'s `NightLobby` polls with `setInterval(() =>
router.refresh(), 3000)` while mounted. `components/import-progress-refresh.tsx`
is the only other live-updating screen in this codebase, and it polls;
there is no Realtime subscription anywhere in the app. Adding one here would
mean publication config plus RLS-on-realtime for what is, at most, a 4-6
person roster refreshing a few times a minute — not a cost this feature
needs to take on.

### Digest: open lobbies must not eat the row budget

`app/api/cron/digest/route.ts`'s nights query takes `.limit(10)` before its
existing JS-side null-check filters incomplete rows out. An open lobby has
no `picked_movie_id` yet, so left unfiltered it could occupy a slot in that
`limit(10)` ahead of nights that actually resolved, silently shrinking what
the digest reports. Added `.not("picked_movie_id", "is", null)` before the
limit. The other four `movie_nights` readers were checked and need no
change: `app/status/actions.ts` filters `.eq("picked_movie_id", movieId)`
directly; `app/page.tsx` reaches nights through `watch_confirmations`, which
`request_watch_confirmations` only ever creates after a pick; `app/api/
export/route.ts` exporting an open lobby is correct — it's the user's own
data; `app/stats/page.tsx` reads `hype_history`, not `movie_nights`, at all.

### Known gaps, left out on purpose

No "leave the lobby" — an attendee who joined by mistake stays an attendee
until the night closes or the lobby is abandoned. No auto-expiry of an
abandoned lobby — an open night with nobody closing it stays open (and
keeps blocking a fresh one via the partial unique index) until someone
starts a night that closes it or a future migration adds a TTL. Neither is
in §4.5's one-line spec, and both are the kind of thing worth deferring
until real usage shows whether they're needed.

### Tests

`supabase/tests/rls.test.sql`: 13 new assertions appended after the
`night_rejections` block, `plan(204)` → `plan(217)`, reusing the phase 11
fixtures (group `88888888...`, C as owner via `handle_new_group`, E as the
explicit member, and the already-closed fixture night `20202020...`).
Positive controls first, per the file's own house rule — including one the
hard way: D, impersonated from the previous block, isn't a member of this
group, so the very first check (confirming the fixture night reads as
closed) had to switch to C's claims *before* asserting anything, or RLS
would silently hide the row and read as `NULL` rather than fail loudly on
the right cause. `open_movie_night`'s first call is wrapped in `lives_ok`
and its result captured into a temp table (`_lobby_open`, the
`_deleted_group_list` idiom already used elsewhere in this file) — there's
no other way to name a row a `security definer` function just created, and
the wrap means a bad grant fails one assertion instead of aborting the
other 216. Then: the new lobby is open; C is its sole attendee; a second
`open_movie_night` call from C returns the *same* id (idempotence); E joins
and the roster becomes two; non-member A is refused both `open_movie_night`
and `join_movie_night` with `42501`; E (an attendee, not the opener) closes
it, and a single `row(...)` comparison confirms `picked_movie_id`, `mode`,
and `closed_at` all landed correctly in one assertion; the roster is still
two after close, proving attendees survive untouched; and a fresh
`join_movie_night` on the now-closed night is refused.

### Verified end to end against real infrastructure

Same standard as the last two gap-fills, extended to two simultaneous
members. **One correction to that standard, worth recording:** two Chrome
tabs in the same profile share cookies at the origin level, so setting each
user's session via `createBrowserClient().auth.setSession()` in a separate
tab does not give them separate identities — the second call silently
overwrites the first, and the first tab's next request runs as the second
user. Caught this the hard way (a lobby's first attendee row was attributed
to the wrong user) and re-verified from a clean lobby with a single tab used
sequentially per user instead. For the one check that specifically needed
two identities acting *concurrently* — confirming an already-open tab
updates on its own within the poll interval — the second user's join was
driven by a direct authenticated REST call against PostgREST (their own
bearer token, no browser or cookie involved) while the first user's tab sat
untouched on the lobby screen; it picked up the new attendee within about
four seconds with no manual reload.

Also caught and fixed during this pass: the open-lobby lookup's
`profiles(display_name)` embed was ambiguous to PostgREST —
`movie_nights` has three distinct relationships to `profiles`
(`created_by` directly, plus the `movie_night_attendees` and
`watch_confirmations` junction tables) — and the query's error was going
unchecked, so it silently read as "no open lobby" instead of failing
loudly. Fixed by naming the FK explicitly:
`profiles!movie_nights_created_by_fkey(display_name)`.

Confirmed: a member with no open lobby sees "Start a remote night"; starting
one lands on `?night=<id>` with the opener as the lobby's sole attendee and
`PresentPicker` gone; a second member on the plain page sees "`<name>`
started a remote night · 1 here" and a working "Join the lobby" link; that
link shows the roster and an "I'm in" button while the second member is
still absent from `movie_night_attendees`; joining (verified both via a
real click and via direct API) adds them, and a tab left open on the lobby
picks the change up on its own within the poll interval; switching modes
and using "None of these" both keep `?night=` in the URL while still
writing to `night_rejections` correctly; "Start over" clears `exclude` but
keeps the lobby; logging the pick closes the night — `closed_at` and
`picked_movie_id` set, exactly one `movie_nights` row for the whole evening,
both attendees still present — and immediately re-offers "Start a remote
night" for a new one; a closed night refuses a new joiner with `42501`;
opening a fresh lobby afterward succeeds cleanly (the partial index doesn't
block on the now-closed row); a non-member opening the lobby URL gets the
app's own 404 ("No such reel"), not a leak; and the digest's query, run
directly, returns the closed/logged night while excluding the still-open
lobby.

---

## Motion pass: press feedback, scroll reveal, and two orchestrated moments

The user's brief named the industry's current reference points for motion
design (Jitter, Sofi, Silo) and asked for it mobile-first. Auditing against
that surfaced three actual gaps, one of them a real bug rather than a taste
call.

### The bug: every piece of press feedback in the app was invisible on a phone

Tailwind v4.3.3 compiles the `hover:` variant inside `@media (hover: hover)`
— confirmed directly in `tailwindcss/dist/lib.js`:
`i.static("hover", p => { p.nodes = [H("&:hover", [B("@media", "(hover:
hover)", p.nodes)])] })`. There was not one `active:` state anywhere in the
codebase. So on a touchscreen — this app's primary surface — every control's
only feedback (`buttonClass`'s `hover:brightness-110`, `movie-card.tsx`'s
`group-hover:opacity-70` backdrop bloom, every nav tab, chip, and vote
button) simply never fired. A tap did nothing visible until the server
answered. Fixed by adding `motion-safe:active:` states to the shared class
constants (`buttonClass`, `overlayButtonClass`, `navLinkClass`, both
`chipBase`s, `VoteControl`'s button base, `ExploreCardActions`' action
class, `MobileNavigation`'s `TabLink` and drawer rows) rather than at call
sites — the same "edit the shared string once" shape those constants exist
for.

Variant order matters and was worth getting right once rather than per file:
`motion-safe:active:scale-[0.97]`, not `active:motion-safe:scale-[0.97]`.
Tailwind v4 applies variants outside-in, and only the first produces `@media`
wrapping `:active`. The transform is what `motion-safe:` gates; the
brightness/colour half of each control's feedback is left un-gated, so
reduced motion drops the movement but never removes the feedback entirely.

### Reversed: scroll-driven reveal

An earlier pass (see "Not in this pass" under the design-reset section
above) deferred `animation-timeline: view()` — support was too unsettled to
pin at the time, so `motion-safe:animate-expose` fired on mount with a
hardcoded `Math.min(i, 10) * 40ms` stagger regardless of scroll position.
Below the fold, everything had finished animating before it was ever seen.

Reversed via Framer Motion's `whileInView` rather than the native CSS
timeline, since the earlier deferral was specifically about browser support
for the CSS primitive — `components/ui/reveal.tsx` sidesteps that question
entirely. It is not one behaviour for every call site: a `trigger` prop
(`"view"` | `"mount"`) makes the failure mode impossible to ship by accident.
`whileInView` only makes sense for content genuinely below the fold in the
*document* scroller (the list grid, groups, inbox); wrapping above-the-fold
content (the night reveal, live search results) in the same thing risks it
staying invisible if the observer callback races hydration, so those use a
plain `animate` on mount instead. The Explore feed keeps its original CSS
`animate-expose` untouched — it lives inside its own `overflow-y-scroll`
container with live YouTube iframes, the one place a scroll-driven effect
could plausibly cost frames, and `whileInView` without an explicit `root`
would measure against the wrong scroller there regardless.

`viewport.margin` in `Reveal` is a pixel value (`"-64px 0px"`), not a
percentage — `margin` forwards to `IntersectionObserver`'s `rootMargin`,
which some browsers reject as a percentage without an explicit `root`.

### Not reversed: View Transitions

Checked before assuming otherwise: `viewTransition` is still an
`experimental` flag defaulting `false` in Next 16.2.12
(`next/dist/server/config-shared.d.ts:699`, `:1416`). The original reason
this stayed out holds, so route/page transitions are still out of scope —
this pass is in-page motion only.

### Framer Motion, added

Three things in this pass have no CSS equivalent: `VoteControl`'s selected
fill sliding between three separate buttons (a shared-element transition —
`layoutId`), `NightPickHero`'s multi-stage orchestrated reveal
(`staggerChildren` across letterbox, backdrop, poster, title, and reasons),
and `/login`'s sequenced arrival (letterbox → beam wash, `beam-a` leading
`beam-b` by ~120ms → the mark → title → a 60ms-staggered cascade of
subtitle/button/divider/form). Added `motion` (motion.dev, current package
name for Framer Motion; React 19 is in its peer range as of `motion@13.0.0`).

Not added to the root layout — no global `<MotionConfig>`. Each animated
component imports `motion/react` itself, so Next's per-route code-splitting
keeps the runtime out of routes that don't use it. Measured directly rather
than assumed: the motion runtime is a single ~120KB (~39KB gzipped) chunk
(`05te2ssus75d-.js` in this build), and `/privacy`'s client reference
manifest has zero references to it while `/`, `/login`, and
`/groups/[id]/night`'s each do.

`VoteControl`'s `layoutId` forecloses shrinking the bundle further with
`LazyMotion`/`domAnimation` — layout animations aren't in that feature
bundle. Accepted rather than worked around; it's the one place in this pass
Framer is doing something CSS structurally cannot.

`lib/motion.ts` centralizes the token layer the same way `globals.css`
already centralizes the CSS side: one easing curve
(`cubic-bezier(0.22, 0.8, 0.3, 1)`, identical to `--animate-expose`'s), the
`expose` keyframe re-expressed as Framer variants, and
`useMotionVariants()`/`useRevealVariants()` so `useReducedMotion()` is
wrapped once rather than re-implemented per component. Every sequence built
on it collapses to a single opacity fade under reduced motion — no
positional movement, matching the precedent `components/venn-loader.tsx`
already set for the CSS side of the system. The pre-existing
`motion-reduce:` fallbacks (`venn-loader.tsx`, `ui/spinner.tsx`,
`ui/skeleton.tsx`, `.ticker-track`) were not touched by this pass.

### VoteControl's fill: optimistic by necessity, not just by nicety

The selected-value fill needed to move the instant a button is tapped, not
once `setRating`/`setHype`'s round trip resolves — the row stays disabled
(`isPending`) for the length of that request, so animating off the
`rating`/`hype` props directly would make the slide visibly late every time.
`VoteControl` now tracks an optimistic `selected` value locally, updated on
click, and syncs back to the server value in a `useEffect` keyed only on
that prop — not on `isPending` — so the sync fires exactly once a real
change lands and can't race the tap that caused it. This is the visual half
of the "Optimistic UI on the vote controls" gap already named in the
platform-layer section above; the disable behaviour and error handling are
unchanged.

### `app/accessibility/page.tsx` reworded

It promised "CSS animations honor user preferences for reduced motion
(`motion-safe` media queries)" — true before this pass, false the moment any
animation is JS-driven. Reworded to cover both paths; this is a user-facing
accessibility claim, not decoration, so it had to change with the code
rather than after a complaint.

### Verification

`pnpm typecheck && pnpm lint && pnpm build` clean. Driven in Chrome at
390×844: `/login`'s sequence plays letterbox → beams (staggered) → mark →
title → cascade in order; `/groups/[id]/night`'s reveal orchestrates
letterbox → backdrop → poster → title → reasons. Press feedback confirmed by
dispatching a real click and screenshotting mid-press on a marquee button, an
overlay button, a nav tab, and a vote button — each dips. Scroll reveal
confirmed both directions: below-fold list items are hidden before scrolling
and arrive on scroll (the bug this fixes), and nothing is left permanently
invisible — above-fold `trigger="mount"` content paints on load, and the
Explore feed's cards all appear scrolling its own nested container. The vote
fill was clicked through Hated → Liked → Loved and slides rather than
cross-fades, moving on tap rather than after the server round-trip.
`prefers-reduced-motion: reduce` emulated and every screen above re-driven:
nothing left mid-animation, nothing invisible, press feedback still present
as colour with no transform. Bundle impact measured directly rather than
assumed (§"Framer Motion, added" above).


---

## TMDB's 6-month cache limit

Migration: `supabase/migrations/20260924120000_catalog_refresh.sql`.
Code: `lib/movies/refresh.ts`, `refreshMovie` in `lib/movies/cache.ts`,
`app/api/cron/refresh-catalog/route.ts`, a second cron in `vercel.json`.

### Why: the catalog was in line to breach TMDB's terms in January 2027

TMDB's API Terms of Use, section 1.C, forbid you to *"Cache, for longer than
6 months, any information obtained through or from TMDB or the TMDB APIs."*
Found on 2026-09-24 while drafting SPEC §2's pre-launch email to TMDB. It is
not in SPEC §2, which only records the purge-on-termination duty.

Phase 1a wrote `movies.fetched_at` and deliberately never read it ("No TTL on
`fetched_at`", phase 1a's "Deferred" list): SPEC §3 says fetch once, never per
read. That stays true on the read path. What changes is that a background job
now re-fetches before six months are up. The oldest rows date from phase 1a
(late July 2026), so the first breach would have landed in late January 2027.

### What counts as cached TMDB data, and how each is handled

| Data | Handling |
|---|---|
| `movies` columns, including `trailer_key` | Re-fetched in place by `refreshMovie` once `fetched_at` is 150 days old |
| `movie_tags` for a title | Replaced in the same refresh: new rows added first, then rows TMDB no longer lists are removed |
| `tags` values (keyword, person and genre names) | Re-stamped every time any title carrying them is cached or refreshed (new `tags.fetched_at`). One no title uses is deleted after a day |
| `movie_releases` | Already re-fetched per region every 12 hours by theatre.ts, but a region nobody opens keeps its rows forever. Rows older than the cutoff are deleted |
| Orphan `movies` rows (no `movie_external_ids` mapping) | Left behind by `persistMovie` failures and races. They can't be refreshed without an external id, so they're deleted after a day |
| `movie_external_ids` | Identifiers, refreshed with the title they point at |

`user_tag_weights` stores numbers keyed by tag id, not TMDB text. It is not
rebuilt when a title's tags change (see the trade-offs below).

Watch providers aren't cached at all: `app/movies/[id]/page.tsx` calls
`getWatchProviders` per render, and `tmdb.ts`'s plain `fetch` goes through no
Next data cache.

### The numbers

`REFRESH_AFTER_DAYS = 150` leaves 30 days of slack under TMDB's 180, for a
TMDB outage, failed runs, or a backlog. `BATCH = 150` titles a run at two
TMDB calls each is at most 300 calls a day. At one run a day that keeps up
with a catalog of about 150 × 150 = 22,500 titles; the slack alone clears a
4,500-title backlog. The route reports `more: true` when a run fills its
batch. If that shows up day after day, raise `BATCH` or run the cron more
often. The cron is `0 21 * * *` (02:30 IST), away from the digest's
`30 3 * * *`. On today's catalog it does nothing until late December 2026.

### Design choices

- **Update in place, never delete and re-cache.** `movies.id` is what every
  list item, rating, night and hype record points at, and most of those
  foreign keys cascade. A refresh keeps the id and rewrites the columns.
  `insertMovie` and `refreshMovie` now share one `movieColumns()`, so a
  refresh can't write a different set of columns than a first fetch.
- **`fetched_at` is written last,** after tags. This is `persistMovie`'s
  commit-marker idea again: if the tag replacement throws, the row stays old
  and tomorrow's run retries it. Stamping first would mark a title fresh over
  tags that were never replaced.
- **Tags are replaced add-then-remove,** not delete-then-insert. The
  recommender can read `movie_tags` at any moment, and a delete first would
  score the title with no tags until the insert landed.
- **`prune_catalog` is `SECURITY DEFINER`, service_role only.** Its
  orphan-movie check reads `hype_history` and `night_rejections`, where
  service_role has no grant. Revoked from `authenticated` and `anon`: nothing
  would leak, but deleting catalog rows early isn't a user's call.
- **The orphan-movie delete checks every cascading reference anyway.** An
  unmapped movie id is never returned to a caller, so nothing should point at
  one. If that reasoning is ever wrong, a user's list item or rating must not
  disappear with it. `rls.test.sql` pins this with an orphan that is on a list.
- **The one-day grace** on orphan movies and tags covers `cacheMovie` in
  flight: its `movies` row exists before its mapping, and a new tag exists
  before its `movie_tags` row.
- **`tags.fetched_at` backfilled** from the newest title carrying each tag,
  not left at the migration's `now()`, which would have made every tag look
  newer than it is.

### Known trade-offs, left open on purpose

- **Titles TMDB has removed (404).** `refreshStaleCatalog` reports them in
  `gone` and logs them, and leaves the row. Deleting it would cascade into
  users' lists and ratings. There is no automatic answer that is both
  compliant and harmless, so this needs a person. The likely fix, if it ever
  happens, is to clear the row's descriptive columns (overview, images,
  trailer, tags) and keep only the title the user added. A 404 row is the
  oldest in the catalog, so it costs two TMDB calls every run until it is
  dealt with.
- **`user_tag_weights` goes slightly stale** when a refresh changes a title's
  tags: a new keyword doesn't count toward a user's weights until their next
  rating triggers `rebuild_user_tag_weights`. Rebuilding every affected user
  from the cron needs a new RPC over the private `_rebuild_tag_weights`, which
  isn't worth it for a keyword drifting on a few-month-old film.
- **No new analytics event.** The route's JSON response and the Vercel cron
  logs are the record.

### TMDB email

SPEC §2's pre-launch email was sent on 2026-09-24 to `sales@themoviedb.org`
(the address TMDB's developer FAQ gives for licensing questions). It asked
whether a free public app is fine on a developer key, about the ML/AI clause,
and about commercial pricing. Worth noting for whoever reads the reply: §1.C's
ML/AI restriction covers use *"in connection with, including for training, a
machine learning (ML) or artificial intelligence (AI) based Application"*,
which is broader than SPEC §2's "ML-trained" framing. The FAQ's test for
commercial use is whether *"the primary purpose is to create revenue for the
benefit of the owner."*

### Verification

- `supabase db reset` applies the migration clean; `supabase test db` passes
  228/228 (11 new: counts, each keep/delete case, and 42501 for
  `authenticated` and `anon`).
- `pnpm smoke:refresh` (new) passes against a local stack with a stubbed
  TMDB: a fresh catalog costs no calls; a 160-day-old title is rewritten in
  place with its keywords swapped; a 404 title is reported and kept; the
  dropped keyword survives its first day and is pruned after; the next run
  retries only the 404. The script refuses to run against a non-local URL.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` clean. `pnpm start` with a
  `CRON_SECRET`: the route answers 401 without it and 200 with the report
  JSON with it.
- **Not verified:** a run against live TMDB. The logic sits on the same
  `getMovie`/`getTags` calls `pnpm smoke:tmdb` already covers, but the first
  real refresh won't happen until late December 2026.

---

## Group and movie-night analytics events

No migration. Server-side PostHog events through the existing
`captureServer` (`lib/analytics/server.ts`), in the actions where each
thing actually happens:

| Event | Fired from | Properties |
|---|---|---|
| `group_created` | `createGroup` (`app/groups/actions.ts`) | `group_id` |
| `group_joined` | `joinGroup`, `joinPublicGroup` | `group_id`, `via: "invite_code" \| "public"` |
| `night_logged` | `logNight` (`app/groups/[id]/night/actions.ts`), after the RPC succeeds | `group_id`, `mode`, `remote`, `attendees` |
| `picks_rejected` | `noneOfThese`, only when the insert succeeded | `group_id`, `mode` |

### Why these four

Before this, PostHog saw page views plus per-user events (`movie_added`,
`vote_cast`, `onboarding_completed`, ingest, imports) and nothing about
groups. Venn is a group product, and the question that decides whether it's
ready for more users is "do groups come back and use it week after week?"
`night_logged` answers that on its own. Distinct `group_id`s per week is the
number, and `group_created` → `group_joined` → `night_logged` is the funnel
behind it. PostHog's per-person counts can't give this: a group's nights are
logged by whichever member taps the button.

The query, as a PostHog SQL insight (no Group Analytics add-on needed):

```sql
select toStartOfWeek(timestamp) as week,
       count(distinct properties.group_id) as groups_with_a_night
from events
where event = 'night_logged'
group by week
order by week
```

### What was left out

- **No group names, ever.** Names are free text (SPEC §11), and a
  third-party analytics store is no place for them. `group_id` is an opaque
  uuid. `/privacy` already names PostHog as the product-analytics provider,
  so no copy change.
- **No lobby-opened or lobby-joined events.** `open_movie_night` returns the
  existing lobby's id when one is open, so the action can't tell "opened"
  from "tapped start on one already open" without an extra query just for
  analytics. `night_logged`'s `remote` flag already shows whether lobbies
  lead to picks. The recommendations shown are the `$pageview` on
  `/groups/<id>/night`.
- `joinGroup` and `joinPublicGroup` now read claims, which they didn't need
  before, because `captureServer` needs a distinct id. Both also return "Not
  signed in." early, matching `createGroup`.

---

## Remote-night lobbies expire after 12 hours

Migration: `supabase/migrations/20260924130000_lobby_expiry.sql`. Closes the
first of the lobby's "Known gaps, left out on purpose" above.

### The gap was worse than recorded

The lobby entry says an abandoned lobby "keeps blocking a fresh one". It
doesn't block: `open_movie_night` hands back the open lobby instead of
refusing. So a group starting a remote night the next week was sent into the
old lobby, with the old attendees still in its roster. `present` comes from
that roster in lobby mode, so the picker excluded films people who weren't
there had watched, scored for their taste, and pushed them a movie-night
invite on logging. "Wait for real usage" was the right call for a group of
friends who would notice. It isn't for strangers.

### The rule, and where it lives

A lobby expires 12 hours after it was opened (`held_at`, which the lobby
flow sets on open and never touches again). There's no last-activity
timestamp to measure from, and adding `joined_at` to
`movie_night_attendees` would be more than the gap needs.

- `open_movie_night` deletes the group's expired lobby, after the
  membership check, before looking for an open one.
- `join_movie_night` refuses an expired lobby with the closed-night message.
- `close_movie_night` refuses one ("this lobby has expired"). Reaching that
  means a tab left open across the cutoff. After a reload, the pick logs as
  an ordinary night.
- The night page (`app/groups/[id]/night/page.tsx`) treats an expired
  `?night=` like a closed one (falls back to the normal page), and its "X
  started a remote night" query filters out expired rows.

The 12 hours is written twice, in the migration and in `lib/lobby.ts`
(`LOBBY_TTL_HOURS`), each pointing at the other. That's a knowing trade: the
alternative was new RPCs for the page's two lobby reads just to share one
constant.

**Deleted, not closed**: closing would leave `closed_at` set with
`picked_movie_id` null, which the lobby entry already rules out, because
null there means "the movie left the catalog". Nothing of value goes with
it: attendee rows cascade, and there are no watch confirmations before a
pick.

**Lazy, not a cron**: an expired lobby is inert (hidden, unjoinable,
unclosable) and only needs to go when the group opens a new one, because of
the one-open-lobby index. `open_movie_night` deletes it at exactly that
point. An expired lobby of a group that never plays again sits there
harmlessly. The digest already filters out nights with no pick.

The other known gap, no "leave the lobby", is still open.

### Tests and verification

- `supabase/tests/rls.test.sql`: `plan(228)` → `plan(238)`. An expired
  lobby can't be joined or closed. A non-member's refused `open_movie_night`
  leaves it in place (the delete runs after the membership check). A
  member's `open_movie_night` hands back a new lobby, deletes the expired one
  along with its roster, and an 11-hour-old lobby is still returned and
  joinable, so a function that expired every lobby on sight would fail.
  238/238 pass.
- Driven end to end in Chromium (390×844) against a local stack with two
  real users signed in by magic-link token, and PostHog pointed at a local
  sink. All four events arrive with the right `distinct_id` and properties,
  and none carries the group name. A lobby backdated to 13 hours disappears
  from the other member's night page, its own link falls back to the normal
  page, and starting a new night creates a fresh lobby whose roster is only
  the person who opened it. The remote `night_logged` reports `remote: true,
  attendees: 2`.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` clean.
- Not driven: `joinPublicGroup`'s event. Same shape as `joinGroup`'s, one
  line apart.

---

## CI

Files: `.github/workflows/ci.yml`, `.github/workflows/migrations.yml`,
`scripts/check-migrations.sh`. No migration; one production role, created by
hand (below).

### What set this off: production had drifted six weeks behind `main`

On 2026-09-24, applying the catalog-refresh and lobby-expiry migrations turned
up four more that had been on `main` since 2026-08-08/09 and never reached
production: `onboarding_five_rating_minimum`, `widen_candidate_pool`,
`none_of_these_log` and `remote_night_lobby`. Vercel deploys `main` on push,
and migrations reach production by hand, so for about six weeks the deployed
code called a table (`night_rejections`), a column (`movie_nights.closed_at`)
and functions (`widen_seeds`, `open/join/close_movie_night`) that didn't
exist. Onboarding was the serious one: the page accepted five ratings while
the database's `complete_onboarding()` still demanded ten. All six were
applied through the Supabase MCP that day, with their recorded versions
reset to the repo filenames, and verified object by object.

Nothing had noticed, because nothing compared the two. `migrations.yml` does.

### `ci.yml`, on every push and pull request

- **app**: `pnpm install --frozen-lockfile`, `typecheck`, `lint`,
  `smoke:ingest`, `smoke:imports` (the two smoke scripts that need no
  network, database or env), and `build` with placeholder env.
- **database**: `supabase start` (Postgres + PostgREST + auth only) applies
  every migration from scratch in order, then `supabase test db` runs
  `rls.test.sql` and `smoke:refresh` runs against the stack. The Supabase CLI
  comes from `supabase/setup-cli`, pinned to package.json's 2.109.1, not from
  `pnpm exec`: whether the npm package fetches its binary depends on
  pnpm-workspace.yaml's build-script allowlist, which is a bad thing for CI
  to depend on.
- **secrets**: gitleaks 8.28.0 over full history. SPEC §11 asked for a
  pre-commit hook, which only guards machines that installed it. The binary
  is used rather than `gitleaks-action`, which needs a paid licence for
  organisation-owned repos. The full history (54 commits) was clean when
  this was added.

The TMDB smoke scripts (`smoke:tmdb`, `smoke:theatre`, `smoke:explore`) aren't
in CI: they need a live TMDB key, and putting the key in CI secrets for a
public repo's workflow widens where it can leak for little gain.

### `migrations.yml`, on push to `main`, daily, and by hand

`scripts/check-migrations.sh` lists the 14-digit versions in
`supabase/migrations/`, reads production's
`supabase_migrations.schema_migrations`, and:

- **fails** for any version in the repo that production lacks. That's the
  failure mode above: deployed code calling schema that isn't there.
- **warns** for any version production has that the repo doesn't: a
  migration applied from elsewhere. Worth knowing, but not breaking.
- **fails** if the secret isn't set, rather than skipping. A skipped check
  looks like a passing one, and a silent gap is what this exists to close.

Not on pull requests: a PR adding a migration is supposed to be ahead of
production until it merges. The daily run keeps a red check red until the
migration is applied, instead of waiting for the next push.

It does **not** stop Vercel from deploying. It tells you, within minutes of
the push, that the deploy is running against a schema it doesn't match. The
order that avoids the gap entirely is still: apply the migration, then push
to `main`. Wiring this script into Vercel's "Ignored Build Step" would turn
it into a gate. Not done: a failed database connection would then block
every deploy.

### `ci_migration_reader`: the only production credential CI holds

Created in production on 2026-09-24:

```sql
create role ci_migration_reader login noinherit;
alter role ci_migration_reader set statement_timeout = '10s';
alter role ci_migration_reader set default_transaction_read_only = on;
grant usage on schema supabase_migrations to ci_migration_reader;
grant select (version) on supabase_migrations.schema_migrations to ci_migration_reader;
```

Checked after creation: it can select `version` and nothing else. It can't
read the migrations' SQL text, `profiles`, `user_movie_status` or
`auth.users`, can't insert into `movies`, and has no elevated attributes.
It can't execute a single `security definer` function in `public`, because
every one was revoked from `public` in its own migration. The column-level
grant is deliberate: `schema_migrations.statements` holds every migration's
full SQL, which is public in this repo anyway, but there's no reason for the
role to have it. `default_transaction_read_only` is a guard, not a boundary,
since a session can switch it off. The grants are the boundary.

It was created **without a password**, so nobody can sign in as it until the
owner sets one. The password never passed through an agent session. Setup,
once:

1. Supabase SQL editor: `alter role ci_migration_reader with password '<long random>';`
2. Dashboard → Connect → **Session pooler** string. GitHub's runners have no
   IPv6, and the direct `db.<ref>.supabase.co` host is IPv6-only. Replace
   the user `postgres.vfkkpflenfpfrrygxmto` with
   `ci_migration_reader.vfkkpflenfpfrrygxmto`, and the password with the
   one above.
3. GitHub → Settings → Secrets and variables → Actions → repository secret
   `MIGRATIONS_DATABASE_URL`.
4. Actions → "Migrations applied" → Run workflow, to confirm.

A local stack doesn't have the role (it isn't in a migration: CI's local
database has nothing to check against). To exercise the script locally,
create it the same way with a throwaway password.

### Verification

- `scripts/check-migrations.sh` against a local stack, connected as a local
  `ci_migration_reader`: in sync → exit 0 ("All 29 migrations…"); an extra
  repo file → exit 1 with a file annotation; an extra production row →
  warning, exit 0; unset secret → exit 1; the role is refused on `profiles`
  and on `schema_migrations.statements`.
- The `.env.local` step's `sed` run against real `supabase status -o env`
  output, then `pnpm smoke:refresh` passing through it.
- `actionlint` 1.7.7 clean on both workflows.
- On GitHub, 2026-09-24: `ci.yml`'s first run (`6bc2f8a`) passed all three
  jobs. `migrations.yml`'s first push run failed as designed, before the
  secret existed. Once the owner set the password and secret, a manual run
  passed ("All 29 migrations in supabase/migrations/ are applied to
  production"), which also confirmed Supavisor accepts `ci_migration_reader`
  in the `role.projectref` form over the session pooler.

### Action versions

`actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`,
`supabase/setup-cli@v3`. The first run used the v4/v4/v4/v1 majors, and
GitHub warned that they target Node 20, which is deprecated on its runners.
Each newer major runs on Node 24 (setup-cli v3 is a composite action). Their
breaking changes don't touch these workflows: setup-node v6 stopped
auto-caching for pnpm, but `cache: pnpm` is set explicitly, and v7's move to
ESM is internal. setup-cli v3 would read the CLI version from
`pnpm-lock.yaml` if `version` were omitted; it stays pinned so the version
is visible in the workflow.

---

## Public-launch hardening

Migration: `supabase/migrations/20260924231422_public_launch_hardening.sql`.
A launch-readiness review found several decisions that were right for "4-6
friends" and stop being right the day strangers can sign up. Some were
recorded as "at this scale" trade-offs. The worst of them only became a
problem once phase 12 made public groups instantly joinable.

### Group list items: adder or creator only

Phase 3's `list_items_delete_via_list` let any member remove any member's
addition ("at 4-6 friends a per-adder delete rule buys friction, not
safety"). With `join_public_group`, that let one stranger empty a public
group's list with a single `delete from list_items`.

- **Delete**: your own personal list, or on a group list the item's adder or
  the group's creator (`groups.created_by`, the same test
  `groups_delete_owner` uses). The creator is the group's only moderator.
  Without that clause an item whose adder left could never be removed:
  leaving deletes the `group_members` row, not the item.
- **Update**: the adder only. The update grant is table-wide, so the old
  policy also let any member rewrite someone else's note or change which
  film an item points at. The creator can remove but not edit. The media-type
  rule from `20260727200002_media_type_tv.sql` is kept in `WITH CHECK`.
- `app/groups/[id]/page.tsx` shows the remove button only to those two
  people. `removeFromList` now asks for the deleted row back, because RLS
  answers a forbidden DELETE with zero rows, not an error, so the old
  action reported success for a delete that never happened.

### Per-user rate limits on every TMDB path

Only `/api/ingest` was limited, so one account (or one script) could use up
the TMDB quota every user shares. The new `rate_limit_hits` table and
`consume_rate_limit(bucket)` count fixed windows per user. The budgets live
in the function, so a caller can't choose its own, and an unknown bucket is
an error:

| bucket  | budget      | charged by |
|---------|-------------|------------|
| search  | 60 / min    | `searchMovies`, the import-fix search |
| catalog | 100 / 10 min | `cacheMovieForUser`, on a cache **miss** only: add-to-list, onboarding votes, import fixes, `/movies/external/[id]` |
| feed    | 30 / min    | Explore (page and load-more), onboarding's popular grid |
| detail  | 120 / min   | a movie page's live availability |
| widen   | 20 / min    | a group night's widen step |
| import  | 120 / min   | one import row in `/api/imports/[id]/process` |
| night   | 10 / hour   | `log_movie_night`, checked inside the function |

Decisions inside it:

- **Postgres, not memory.** A Vercel function instance doesn't outlive its
  request.
- **Fixed windows.** The function deletes the caller's older windows for a
  bucket on each call, so the table holds at most one row per user per
  bucket. A boundary can let 2x through, which doesn't matter for "don't use
  up the quota".
- **Per user, not global.** A global cap would let one abuser lock everyone
  out, which is the outage this exists to prevent.
- **Fails open** (`lib/rate-limit.ts`). A counter error lets the request
  through, rather than a database blip breaking search for everyone.
- **Each path degrades in its own way**: search throws (the form already
  shows "Search failed"), Explore says "Slow down a moment" rather than the
  false "Nothing left to rate", the movie page shows its existing
  availability-failed state, the night page skips widening (the same result
  as TMDB being down), and imports return 429 with `Retry-After`, which
  `components/import-runner.tsx` now waits out.
- `/share` (Android share target) now draws on `/api/ingest`'s budget too.
  Both write `ingest_inbox`, and `lib/ingest/limit.ts` counts that table
  whatever the source. It was unlimited before, although each share
  resolves against TMDB.

### 18+ only (DPDP)

India's DPDP Act treats everyone under 18 as a child whose data needs
verifiable parental consent. Venn doesn't collect that consent, so it is
18+ by declaration:

- `profiles.age_confirmed_at`, written only by `confirm_age()` (not in the
  column-scoped update grant, same as `onboarded_at`).
  `complete_onboarding()` refuses without it.
- The age step comes first in `/onboarding`. The proxy treats "onboarded"
  as `onboarded_at` **and** `age_confirmed_at`, and the `venn_onboarded`
  cookie value moved from `"1"` to `"2"`, so everyone who onboarded before
  this passes through the age step once on their next visit (no step counter
  for them).
- "I'm under 18" deletes the account on the spot, using `deleteAccount`.
  Google sign-in had already created it with a name and email, and keeping
  a child's data while waiting for them to turn 18 is what the rule forbids.
- PostHog in the browser starts only when the `venn_analytics` cookie is
  present. The proxy sets it alongside `venn_onboarded=2`, and it's cleared
  on sign-out and deletion. Login, legal pages and onboarding are never
  tracked. The server-side `captureServer` events all sit behind the
  proxy's gate, apart from `/share`, which is exempt from the proxy, so
  `/share` now checks both columns itself.
- A self-declaration, not verification. That's the usual standard for a
  service that isn't aimed at children. It isn't legal advice: have it
  reviewed before relying on it.

### Smaller fixes found on the way

- **`logNight` pushed to client-supplied ids.** `log_movie_night` filtered
  `p_present` to members, but the push loop in
  `app/groups/[id]/night/actions.ts` used the raw array, so any signed-in
  user could send a "movie night invite" push to any user id. It now reads
  recipients back from `movie_night_attendees`.
- **Theatre pool refresh race** (`lib/movies/theatre.ts`). Delete-then-insert
  ("a harmless leak at this scale") gave 4 of 8 concurrent renders an empty
  pool when a region's TTL expired. Now upsert-then-prune (`fetched_at` older
  than this refresh's stamp). `scripts/theatre-race-smoke.ts` pins it
  against a stubbed TMDB. It fails on the old code and runs in CI.
- **Privacy policy**: names Google sign-in, YouTube (the Explore embeds, which
  connect to YouTube even in nocookie mode), JustWatch, the analytics
  consent point, the rate-limit counters, and a Children section. The Terms
  gain Eligibility (18+), no scraping or automated access, and the
  group-list removal rule. `LAST_UPDATED` is shared, so the About and
  Accessibility pages show the new date too.
- The data export now includes `onboarded_at` and `age_confirmed_at`.

### Still open

- ~~**Many accounts.**~~ ~~**Taste inference in public groups.**~~ ~~**Group
  list size.**~~ Closed by "Public-launch follow-ups" below. The taste
  inference fix is not the one suggested here: hiding counts wasn't enough.
- The SPEC §2 email to TMDB (developer key for a free public app) is still
  unsent.

### Tests and verification

- `supabase/tests/rls.test.sql`: `plan(238)` → `plan(258)`. A plain member
  can't delete or edit another's group item. The adder can edit their own.
  The creator can remove a member's item but not edit it. Age confirmation
  can't be set directly, `complete_onboarding` refuses without it, and
  `confirm_age` stamps it. Rate limits: an unknown bucket is refused, 20
  widen calls pass and the 21st is refused, budgets are per user, the table
  can't be read or reset directly, anon can't call the function, and
  `log_movie_night` refuses past the night budget while a member with budget
  left still logs. 258/258 pass.
- `pnpm smoke:theatre-race` (new): PASS, and FAIL on the pre-fix
  `theatre.ts`.
- The age gate, driven in Chromium against a local stack and production
  build (17 checks): a new user lands on the age step, can't reach
  `/search`, gets past it, and has no analytics cookie before onboarding is
  done. A pre-gate user holding the old cookie is sent to the age step with
  no step counter, confirms, lands on `/`, and gets `venn_onboarded=2` plus a
  script-readable `venn_analytics`. "I'm under 18" deletes both the auth user
  and the profile. The profile step after it couldn't be rendered, because
  the sandbox has no TMDB key for the region list.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `smoke:ingest`,
  `smoke:imports`, `smoke:refresh` clean.

### How this reached the remote project

Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP, the same way as
every earlier phase, with the file's SQL unchanged. `apply_migration` stamped
`20260924231422`, so the file was renamed from `20260924140000` to match,
which is what `scripts/check-migrations.sh` compares. Checked afterwards in
production: RLS is on for `rate_limit_hits` and it has no grants for anon,
authenticated or service_role. `consume_rate_limit`, `confirm_age` and
`log_movie_night` are executable by authenticated and not by anon.
`profiles.age_confirmed_at` isn't updatable by authenticated. The security
advisor's new findings are the intended ones: `rate_limit_hits` with no
policies (reached only through the function), and three more
SECURITY DEFINER functions callable by authenticated, the same pattern as the
existing 20. Production had 7 profiles, 3 of them onboarded. Those 3 see the
age step once, the first time they come back after this deploys.

---

## Public-launch follow-ups: error tracking, many accounts, public-group nights

Migrations: `supabase/migrations/20260925063651_public_group_nights.sql`,
`supabase/migrations/20260925063716_ip_rate_limits.sql`. Three of the four
"Still open" items above, plus error tracking, which the launch-readiness
review found missing: uncaught errors went to Vercel's runtime logs (an
hour of history on Hobby, no alerts) and nowhere else.

### Error tracking: PostHog, not Sentry

- `instrumentation.ts` implements Next's `onRequestError`, so every uncaught
  error in a render, route handler, server action or the proxy is sent as a
  `$exception` event (`lib/errors/report.ts`), with the digest the error page
  shows the user, the route, and the deploy's commit.
- In the browser, `components/error-reporter.tsx` catches `window.onerror`
  and unhandled rejections, and `app/error.tsx` / `app/global-error.tsx`
  report render errors that have no digest (a digest means the server
  already reported it). They post to `/api/errors`, which forwards
  server-side.
- **Why PostHog:** it's already the analytics vendor (SPEC §1), already in
  the privacy policy, and its Error Tracking groups `$exception` events into
  issues and alerts on them. Sentry would have been a new dependency, a new
  vendor and a new account for the same outcome at this size.
- **Anonymous on purpose.** No user id, `$process_person_profile: false`,
  email addresses stripped from messages and stacks, query strings dropped.
  That keeps error reports outside the analytics consent gate
  (`venn_analytics`), which matters because login and onboarding, the pages
  a broken deploy costs the most users on, are never tracked.
- **`/api/errors` is public** (it's in `PUBLIC_PATHS`, since the login page
  has no session), so it's also a way to spend PostHog's quota from
  outside. It takes same-origin requests only (`Sec-Fetch-Site`, `Origin` as
  the fallback) up to 16 KB, with a budget of 30 reports a minute per
  network. The browser side sends at most 5 per page load, each distinct
  error once.
- Next's control-flow throws (`notFound()`, `redirect()`, dynamic-rendering
  bailouts) are filtered out by digest.
- Setup: `NEXT_PUBLIC_POSTHOG_KEY` must be set in production (without it,
  reports only reach the logs), and an alert has to be created in PostHog →
  Error Tracking. The code can't do that part.

### Many accounts: a captcha, and per-network budgets

Per-user budgets reset with every new account, and a magic link needs only
an email address.

- **Captcha:** Cloudflare Turnstile on the magic-link form
  (`components/turnstile.tsx`), with the token passed to `signInWithOtp`.
  Supabase verifies it, using the secret held in the project's Auth
  settings. Explicit rendering, because the script's implicit scan runs once
  and would miss a client-side navigation back to `/login`. The widget is
  reset after every submit, since tokens are single-use. Google sign-in has
  no captcha: Supabase can't put one in front of OAuth, and Google accounts
  already cost something to make. When `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is
  unset (local, CI) the form works without one. Supabase ignores the token
  until captcha is switched on, so the code ships first and the dashboard
  switch comes second. The other order would break magic-link sign-in until
  the deploy lands.
- **Trade-off:** with the key set, a browser that can't reach
  `challenges.cloudflare.com` (a strict blocker, a filtering network) can't
  send a magic link. Google sign-in still works. Accepted.
- **Per-network budgets:** `withinRateLimit` now charges the caller's
  network as well as their account (`consume_ip_rate_limit`), so a script
  cycling accounts from one machine shares one budget. The budgets are about
  5x the per-user ones, because carrier-grade NAT on Indian mobile networks
  and hostel Wi-Fi put many real people behind one address. IPv6 is
  counted per /64, since one host can rotate addresses inside its /64 for
  free. The key is an HMAC of the address (`RATE_LIMIT_IP_SECRET`, falling
  back to the service-role key so a missing env var can't switch it off),
  so the table never holds an address. Rows older than an hour are swept on
  every call. Only `service_role` can call the function: a signed-in user
  who could would choose their own key.
- The IP comes from `x-forwarded-for`, which Vercel overwrites with the real
  client address. On another host that header is client-controlled and this
  limit would be trivial to dodge. It fails open, like the per-user limit,
  and is skipped outside a request (the smoke scripts).
- Supabase Auth's own per-IP limits on OTP sends and verifications still
  apply underneath all of this.

### Public-group nights: consent, not hidden counts

The suggestion above (hide counts below 3 present) would not have closed
the leak. `p_present` was whatever the caller passed, so a stranger could
pass the victim alone. The picks were then the victim's own ranking, and
worded "You're hyped for this". Rerolling to "That's everything" listed
every group-list film the victim hadn't watched, so the rest was their
watch history. `widen_seeds` returned their top-rated list films. And
`seen_count` counted every group member, so even without marking the victim
present, "Nobody here has seen it" appearing or not showed whether someone
in the group had watched each pick.

The rule now, in `_assert_night_consent`, called by `recommend_movies` and
`widen_seeds`: **in a group that has ever been public, every present member
other than the caller must be an attendee of the group's open, unexpired
lobby, and so must the caller.** Joining a lobby is always an explicit
"I'm in" tap, so a member's taste enters a night only when they chose to be
in it, and the lobby shows them who else is. The caller alone is always
allowed, since that reads only their own rows. Invite-only groups keep the
checklist unchanged, because those members were handed the code by someone.

- **`groups.opened_to_public_at`**, stamped by trigger the first time a group
  becomes public and never cleared. An owner who flips back to invite-only
  keeps every stranger who joined, since there's no way to remove a member,
  so `visibility` alone can't decide. Groups flipped back before this
  migration can't be recovered, because nothing recorded it.
- **`seen_count`** in those groups counts present members only, so it's 0
  for every candidate and "Nobody here has seen it" always shows. That's
  accurate for the people who are here.
- **The night page** mirrors the rule instead of asking for a night it
  would be refused. In a public group, outside a lobby, it picks for you
  alone and says why, with no checklist. In a lobby you haven't joined, it
  shows "Join to see the picks".
- **Still true after this:** two people who both joined a lobby can each
  read the other's hype from the counts. That's what a joint night is, and
  both chose it with the roster on screen.
- The 12 hours is now in four places (see `lib/lobby.ts`).

### Group lists past `max_rows`

The night page read the group list through PostgREST so it could pass it
back as `p_candidates` alongside widened titles, and PostgREST caps a read
at 1000 rows. `recommend_movies` gains `p_extra`: titles scored on top of
the group list, which it now always reads itself in SQL, uncapped. The page
no longer reads the list at all. The group page shows the list through the
same cap, so it now asks for the true count and says "Showing the newest
1000 of N" rather than quietly showing 1000. `widenCandidates` checks list membership
only for its own few dozen candidates, so a title already on the list
isn't labelled "Not on your lists yet". It's a new signature, so the old
function is dropped rather than overloaded, which would make PostgREST's
named-argument resolution ambiguous.

### Tests and verification

- `supabase/tests/rls.test.sql`: `plan(258)` → `plan(282)`. The stamp is
  set on creation and survives a flip back and a direct update. A stranger
  can pick for themselves alone. `seen_count` doesn't leak an absent
  member's watch. The stranger can't run the picker on the member alone,
  with themselves, or through `widen_seeds`, and can't from outside the
  member's lobby, but can once they've joined it. An expired lobby doesn't
  count. `p_extra` adds to the pool rather than replacing it. Network
  budgets: unknown bucket and short key refused, 30 pass and the 31st
  doesn't, per-network independence, the sweep, and no access for
  `authenticated` or `anon`. With `_assert_night_consent` stubbed to a
  no-op, exactly the five leak assertions fail.
- In Chromium, against a production build and the local stack (12 night
  checks, 4 error-tracking checks, 5 captcha checks):
  - **Public group:** a stranger gets solo picks with no checklist, and
    `?present=<victim>` is ignored. The stranger is asked to join a lobby
    before seeing picks, and is scored with the victim once joined.
  - **Invite-only group:** the checklist is unchanged.
  - **Server errors:** a `permission denied` error thrown in `/movies/[id]`
    reaches the (stubbed) PostHog endpoint with the digest shown on the
    error page. A `notFound()` sends nothing.
  - **Browser errors:** an uncaught error arrives through `/api/errors`.
    The endpoint answers 403 cross-site, 413 when oversized, and 429 on
    the 31st report from one network, and the table holds only HMACs.
  - **List size:** with 1,103 films on a group list, the group page says
    "Showing the newest 1000 of 1103". The night picker still picks the
    oldest film, which the grid can't show, because both friends are
    superhyped for it.
  - **Captcha:** Turnstile was stubbed with its explicit-render API,
    because this sandbox's browser can't reach Cloudflare. The button stays
    disabled until there's a token, the token reaches the form, the widget
    resets after a submit, and there's no overflow at 360px.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `smoke:ingest`,
  `smoke:imports`, `smoke:refresh`, `smoke:theatre-race` clean.

### How this reached the remote project

Applied to `vfkkpflenfpfrrygxmto` through the Supabase MCP on 2026-09-25,
file SQL unchanged. `apply_migration` stamped `20260925063651` and
`20260925063716`, so the files were renamed from `20260925000100` and
`20260925000200` to match. Before that, production matched the repo
exactly, with 0 public groups and 0 open lobbies. The largest group list
was 15 films.

Applying it ahead of the code is safe for what `main` deploys today. The
old night page calls `recommend_movies` with named arguments, which resolve
to the new function because `p_extra` defaults to null. The consent rule
only touches groups that have been public, and there were none.

Checked afterwards:
- **Grants:** one `recommend_movies`, the five-argument one, executable by
  authenticated and not anon. `widen_seeds` is the same.
  `_assert_night_consent` is executable by neither. `consume_ip_rate_limit`
  is executable by service_role only.
- **Tables and columns:** `ip_rate_limit_hits` has RLS on and no grants.
  `groups.opened_to_public_at` is readable by authenticated and not
  updatable, and the trigger exists.
- **Live calls:** as a real member of the largest group, in a transaction,
  the old-style call, the old-style call with `p_candidates`, and the new
  `p_extra` call each returned 3 picks, and `widen_seeds` answered.
- **Security advisor:** only the expected findings. `ip_rate_limit_hits`
  has no policies, and the count of SECURITY DEFINER functions signed-in
  users can execute is unchanged at 23.

### To do by hand, in this order

1. ~~Apply both migrations to production.~~ Done, above.
2. Cloudflare → Turnstile: create a widget for the production domain. Put
   the site key in Vercel as `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Optionally
   set `RATE_LIMIT_IP_SECRET` to a long random string. Deploy.
3. Supabase → Authentication → Attack Protection: enable CAPTCHA, provider
   Turnstile, with the secret key. Only after step 2 is live.
4. PostHog → Error Tracking: check issues are arriving, and add an alert.


---

## Public-launch growth surface: landing page, invite links, link previews

No migration. A second launch-readiness pass, this time asking what a
stranger sees, rather than what they can break. On production, 2026-09-25:

- A signed-out visit to `/` redirected to `/login`: one sentence and a
  sign-in form. Every marketing link and every installed-app launch by a
  signed-out user started there.
- An invite was a code to read out. The invitee had to find the site, sign
  up, finish onboarding, then find the form on `/groups` and type the code.
  Groups are the product (§4 runs on members marked present), so that's the
  one growth loop the app has.
- A pasted link unfurled as the word "Venn": no `og:*` or Twitter tags, no
  image.
- `/accessibility`, `/robots.txt` and `/sitemap.xml` answered signed-out
  requests with the login page. The first is linked from the footer on every
  page.
- `/login?error=link_invalid` was never read (noted as a gap in the Google
  OAuth entry above), so an expired or pre-opened magic link landed on a
  blank form.

### `/welcome`, not `/`

`lib/supabase/proxy.ts` redirects a signed-out `/` to `/welcome`; every other
path still goes to `/login`, since a deep link usually means a returning
user. The landing page has its own path because `components/mobile-navigation.tsx`
and `components/site-footer.tsx` decide what to show from the pathname alone,
and at `/` the tab bar would have rendered for signed-out visitors. The page
redirects a signed-in visitor home.

Every claim on it maps to something the code does: the sample reasons are
`lib/recommend/explain.ts`'s strings, "leans toward the film the least happy
person still likes" is §4.3's `0.7 × min + 0.3 × mean`, the lobby copy says
"the picks count whoever joined" because only group members can join one. No
poster art: TMDB's images are for showing a title, not for marketing the app
around them.

### Invite links: the code never reaches a rendered URL

`/join/<code>` never renders. The proxy moves the code into an httpOnly
`venn_invite` cookie (24 hours) and redirects: signed in → `/join`, signed out
→ `/welcome?invite=1`. The code is a bearer credential for the group, and
`components/analytics.tsx` sends every pathname to PostHog, so a page at
`/join/<code>` would have leaked every code into analytics. The Chromium run
below asserts that no rendered URL ever carried the code.

It's a cookie and not a `next` parameter because nothing would carry a
parameter through: Google returns to `/auth/callback` and the magic link to
`/auth/confirm`, each with a fixed URL, and the proxy puts a new account
through the age step and onboarding before any page it asked for. So the
four places that end sign-in or onboarding — both auth routes,
`confirmAge`'s already-onboarded exit and `completeOnboarding` — go to
`/join` while the cookie is set (`homeOrInvite` in `lib/invite.ts`). `/join`
isn't in `PUBLIC_PATHS`, so the age gate still runs before anyone can join a
group.

- **Joining takes a POST.** `/join` shows "Join the group" and "Not now"
  buttons, each a server action. A GET that joined would let any page join a
  signed-in visitor to a group with one link.
- **The cookie is cleared** on join, on dismiss, on a failed join, on
  sign-out and on account deletion, so it can't follow the next person on a
  shared device.
- **No group name before joining.** `groups_select_member` hides the group
  from non-members, and a lookup by code would be a new SECURITY DEFINER
  function for one line of copy. The group page names the group the moment
  the join lands.
- **Errors come back as `?error=`, not as action state.** The first version
  returned them through `useActionState`, and testing showed the message
  never appeared. Deleting a cookie in a server action makes Next re-render
  the route, the re-render found no invite, and the component holding the
  error unmounted, leaving "No invite waiting". Server-rendering the error
  from the URL survives that re-render.
- `group_joined` gains `via: "invite_link"` beside `invite_code` and
  `public`, which is the measure of whether links beat codes.
- The group page's "Share invite link" opens the system share sheet
  (`navigator.share`, on phones) or copies the link.

### Link previews

`app/layout.tsx` sets `metadataBase` from `lib/site.ts` (`NEXT_PUBLIC_SITE_URL`,
else Vercel's `VERCEL_PROJECT_PRODUCTION_URL`), plus `openGraph` and
`twitter` blocks. `app/opengraph-image.tsx` renders once at build with the
app's two faces fetched from Google Fonts. It uses both fonts or neither,
because custom fonts replace `next/og`'s default and the renderer takes each
glyph from the first font that has it. With Anton alone, the subtitle's
capital T came out in Anton. A failed font fetch falls back to the default
face, never to a failed build. The mark is drawn as three shapes (the lens is
circle B clipped to circle A, filled white), since the renderer has no
`plus-lighter`.

`app/robots.ts` disallows `/api/`, `/auth/`, `/join/` and `/share`.
`app/sitemap.ts` lists the five pages a signed-out visitor can read. All of
these, plus `/opengraph-image`, are in `PUBLIC_PATHS`, because crawlers and
link unfurlers have no session.

Also removed: the five create-next-app SVGs in `public/`, which nothing
referenced.

### Verification

- In Chromium, against a production build and the local stack (41 checks, two
  consecutive clean runs): signed-out `/` lands on `/welcome` at 360px and
  1280px with no horizontal overflow, no tab bar and the footer links, and
  `/accessibility` reads signed out. An invite followed while signed out
  sets the cookie (httpOnly, code uppercased), shows the banner, survives
  magic-link sign-in and the age step, lands on `/join` with the code absent
  from the page, and joins. The group page names the group, the membership
  row exists, the cookie is gone, and no navigated URL contained the code.
  An onboarded user following a link goes straight to `/join`, and "Not now"
  goes home without joining. Bare `/join` says nothing is waiting. A
  well-formed code that matches no group shows its error and clears the
  cookie, and sign-out clears a waiting invite. The share button copies
  `<origin>/join/<code>`, and the group page still fits 360px.
- A bogus `/auth/confirm` token lands on `/login?error=link_invalid` with the
  message. Plain `/login` shows none.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` (CI's placeholder env too),
  `smoke:ingest`, `smoke:imports`. `supabase test db`: 282/282 on a fresh
  `db reset`. It failed one control, "A sees all non-blocked profiles"
  (25 against 7), when run after the browser tests without a reset, because
  those tests had added profiles.
- Not verified here: the profile and rating steps of onboarding, which need
  a TMDB key the sandbox doesn't have. `completeOnboarding` shares its exit
  (`afterOnboardingPath`) with `confirmAge`, which was driven.

### By hand, and what this doesn't settle

See `docs/LAUNCH.md` for the launch checklist and why revenue waits. In short:
set `NEXT_PUBLIC_SITE_URL` when a custom domain lands (before marketing, since
every shared invite link carries the domain), and confirm that magic links
reach addresses outside the Supabase organization.
