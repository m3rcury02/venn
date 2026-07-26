# Decisions

**Current phase: 0**

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
