# Decisions

**Current phase: 3**

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
