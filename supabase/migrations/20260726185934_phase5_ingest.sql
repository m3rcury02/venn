-- Phase 5: the ingest endpoint, its tokens, and the Inbox.
--
-- SPEC §5 calls share-to-app "the daily engagement loop, not a convenience
-- feature". Phases 0-4 left exactly one way to get a movie into Venn: type it
-- into /search. This is the second door -- a token-authenticated endpoint that
-- takes arbitrary shared text and either resolves it or parks it for the user.
--
-- The governing rule is §5's: "Never guess. A silent wrong add is worse than a
-- badge." Everything below is biased toward `pending`.
--
-- Deliberately NOT here, per phase 0's rule (defer a table to the phase that
-- first consumes it):
--   * The Android Web Share Target and the iOS Shortcut are §9's phase 6. This
--     migration's `source` column and a mintable token are what they plug into.
--   * `imports` (§3, phase 8) is a different ingestion path and shares nothing
--     with this one -- it has an IMDb id per row and never disambiguates.
--
-- No functions this phase. The route runs as service_role (it must, to look a
-- token up by hash before any user identity exists); the Inbox actions run as
-- the authenticated user under the policies below. Nothing needs SECURITY
-- DEFINER, which is the first phase since 2 that can say so.

-- ---------------------------------------------------------------- enums

-- Real enums rather than text + check, following phase 0's precedent
-- (movie_rating, movie_hype, tag_type).
--
-- §5: "Instrument every ingest with its source. That number decides whether the
-- Apple developer account is worth it." Only 'paste' can be produced today;
-- phase 6 sends the other two.
create type ingest_source as enum ('android_share', 'ios_shortcut', 'paste');

create type ingest_status as enum ('pending', 'resolved', 'rejected');

-- --------------------------------------------------------------- tokens

-- §5: "Treat the token as low-trust: ingest scope only, revocable,
-- rate-limited." The scope is structural -- this table grants nothing beyond
-- reaching /api/ingest as one user.
--
-- token_hash is HMAC-SHA256 keyed on INGEST_TOKEN_PEPPER (§11), never the token
-- itself. Deterministic on purpose: a per-row salt would force a full scan on
-- every request, and the token is 32 random bytes, so there is no dictionary to
-- defend against -- the pepper exists to make a leaked database dump useless on
-- its own, which a keyed hash achieves.
create table ingest_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  token_hash    text not null unique,
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  -- Revoked rather than deleted: a token that started appearing in logs after
  -- being revoked is worth being able to name.
  revoked_at    timestamptz
);

-- The unique constraint above already indexes token_hash, which is the lookup
-- on every single ingest request. This one serves the Settings list.
create index ingest_tokens_user_id_idx on ingest_tokens (user_id);

-- ---------------------------------------------------------------- inbox

-- §3, verbatim. The row is inserted `pending` and synchronously, before the
-- endpoint answers -- see app/api/ingest/route.ts for why that ordering is not
-- the one §5 step 1 literally describes.
create table ingest_inbox (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references profiles (id) on delete cascade,
  raw_text             text not null,
  source               ingest_source not null default 'paste',
  status               ingest_status not null default 'pending',
  -- Internal movies.id, not provider ids: resolved_movie_id is a uuid FK, so
  -- whichever candidate the user picks has to be cached anyway. Caching the top
  -- 3 up front moves 2 TMDB calls per candidate (and phase 1a's measured ~20%
  -- ECONNRESET rate) out of the user's click path and into the endpoint's
  -- deferred half, and lets the Inbox render posters with no provider call at
  -- all. Capped at 3 by the route, not by a constraint -- see below.
  candidate_movie_ids  uuid[] not null default '{}',
  resolved_movie_id    uuid references movies (id) on delete set null,
  created_at           timestamptz not null default now(),
  -- A resolved row names the movie it resolved to; pending and rejected ones do
  -- not. Without this, "resolved" could mean two different things in the Inbox
  -- query and the badge count would drift from what is on screen.
  constraint resolved_has_movie check (
    (status = 'resolved' and resolved_movie_id is not null)
    or (status <> 'resolved' and resolved_movie_id is null)
  )
);

-- There is deliberately no FK from candidate_movie_ids into movies: Postgres
-- cannot express one on an array element. The route only ever puts ids there
-- that cacheMovie just returned, and `on delete set null` above covers the one
-- id that actually matters. A stale candidate id matches no row in the Inbox's
-- join and simply does not render.

-- Serves both the Inbox page's ordering and the route's rate-limit count, which
-- would otherwise seq-scan the table on every request.
create index ingest_inbox_user_created_idx
  on ingest_inbox (user_id, created_at desc);

-- --------------------------------------------------------- table grants

-- Same two-gate reasoning as phases 0, 3 and 4, and the REVOKE is just as
-- non-redundant: hosted Supabase carries ALTER DEFAULT PRIVILEGES granting all
-- DML on new tables to anon, authenticated and service_role, while a fresh
-- local stack grants none. Revoking first is what makes the two environments
-- end up identical.

revoke all on ingest_tokens, ingest_inbox
  from anon, authenticated, service_role;

-- ingest_inbox: SELECT and UPDATE only. There is no INSERT grant and no INSERT
-- policy, and that absence is the enforcement -- the same argument phase 0 made
-- for the catalog tables, phase 3 for group_members and phase 4 for
-- user_tag_weights. Rows come from /api/ingest, which is the only thing that
-- has verified a token. UPDATE is how the user resolves or rejects.
--
-- No DELETE either: rejecting sets a status. §5's whole point is that a share
-- is never silently lost, and a delete grant would undo that.
--
-- UPDATE is column-scoped for the same reason it is on ingest_tokens below:
-- resolve and reject are the only two edits that exist, and they touch exactly
-- these two columns. raw_text is what the user actually shared and
-- candidate_movie_ids is the endpoint's work -- neither is the user's to rewrite
-- afterwards, and the grant is what makes that structural.
grant select on ingest_inbox to authenticated;
grant update (status, resolved_movie_id) on ingest_inbox to authenticated;

-- ingest_tokens: the column list on SELECT is the point. RLS is row-level, so
-- without it the owner's own *browser* could read token_hash out of their row.
-- The hash is not the token, but it is the only thing standing between a leaked
-- read and a forged ingest if the pepper ever escapes too, and there is no
-- reason for it to leave the server. One line, and it matches this repo's
-- "grants are a second gate" reasoning.
grant select (id, user_id, label, created_at, last_used_at, revoked_at)
  on ingest_tokens to authenticated;

-- INSERT is not column-scoped because the hash has to be written; the plaintext
-- never touches the database and the hash is never read back. UPDATE is scoped
-- to revoked_at, which makes "revoke" the only edit that exists: relabelling and
-- un-revoking are not features, and this grant is what keeps that true rather
-- than the UI merely not offering them.
grant insert on ingest_tokens to authenticated;
grant update (revoked_at) on ingest_tokens to authenticated;

-- The route holds the service-role key: it looks a token up by hash before any
-- user identity exists, stamps last_used_at, and writes the inbox row.
grant select, insert, update, delete on ingest_tokens, ingest_inbox
  to service_role;

-- Phase 5 is the first thing that writes a *user's* rows from the server, so
-- these three grants are new -- and their absence was a real bug, not a
-- theoretical one. Phase 0 revoked everything from service_role and granted
-- back only the catalog tables, because at the time nothing server-side touched
-- anything else. §5 step 5 ("add to default list, mark resolved") changes that.
--
-- The failure it produced is worth recording because it is silent in both
-- directions: postgrest returns an error the caller has to *look at*, so an
-- ingest resolved the movie, marked the row resolved, and added nothing to any
-- list. service_role bypassing RLS is not the same as service_role reaching the
-- table -- grants are a second gate, exactly as phase 0 documented.
--
-- Scoped to what the route actually does and nothing more: find the default
-- list, add one item, read the region for the provider search. No UPDATE or
-- DELETE anywhere, so the endpoint cannot alter or remove anything a user
-- already has.
grant select on lists to service_role;
grant insert on list_items to service_role;
grant select on profiles to service_role;

-- ------------------------------------------------------------------ RLS

alter table ingest_tokens enable row level security;
alter table ingest_inbox  enable row level security;

-- Own rows only, exactly like user_movie_status and user_tag_weights. Nothing
-- about ingest is shared -- not with group peers, not with anyone. Phase 10's
-- visibility toggles have no bearing here either.

create policy ingest_tokens_select_own on ingest_tokens
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy ingest_tokens_insert_own on ingest_tokens
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- WITH CHECK as well as USING, so a row cannot be handed to another user on the
-- way past. The grant above already limits the write to revoked_at, but the
-- policy should not depend on the grant to be correct.
create policy ingest_tokens_update_own on ingest_tokens
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy ingest_inbox_select_own on ingest_inbox
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy ingest_inbox_update_own on ingest_inbox
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
