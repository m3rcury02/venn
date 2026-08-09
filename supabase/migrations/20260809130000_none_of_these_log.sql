-- SPEC §4.5's "None of these" edge case: "log it -- useful signal." Deferred
-- from phase 4 to phase 11 (docs/DECISIONS.md), then still missing at the end
-- of phase 11. Closed here, out of band against phase 4, same as §4.2's widen
-- step was.
--
-- Write-only by design: nothing in the app reads this table. Rejections are
-- the only negative signal the recommender produces at the pick level (`hate`
-- ratings and scroll-past are both about titles, not about a specific Top 3),
-- so it is worth capturing even with no reader yet.

create table night_rejections (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups (id)   on delete cascade,
  user_id    uuid not null references profiles (id) on delete cascade,
  -- Cascades, unlike movie_nights.picked_movie_id (set null): that column is
  -- set null so the night record survives a catalog deletion, but here the
  -- movie *is* the record -- a rejection with no movie says nothing.
  movie_id   uuid not null references movies (id)   on delete cascade,
  mode       text not null check (mode in ('home','theatre')),
  created_at timestamptz not null default now()
);

create index night_rejections_group_idx on night_rejections (group_id, created_at desc);

-- No unique constraint: rejecting the same title three Fridays running is
-- stronger signal than rejecting it once, so repetition has to survive.

-- --------------------------------------------------------------- grants

revoke all on night_rejections from anon, authenticated, service_role;

-- No update/delete grant -- this is a log, not a mutable list.
grant select, insert on night_rejections to authenticated;

-- No service_role grant: nothing server-side reads this table, and the
-- operator reads it as postgres, which bypasses both gates anyway.

-- ------------------------------------------------------------------ RLS

alter table night_rejections enable row level security;

-- is_group_member is load-bearing here, not just user_id = auth.uid(): without
-- it a user could log rejections into a group they aren't in and poison that
-- group's signal.
create policy night_rejections_insert_own on night_rejections
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_group_member(group_id));

-- Select-own, not select-member: reports_select_own is the precedent. Nothing
-- in the app reads this table, so the narrower policy costs nothing today and
-- doesn't need walking back later if a reader is ever added.
create policy night_rejections_select_own on night_rejections
  for select to authenticated
  using (user_id = (select auth.uid()));
