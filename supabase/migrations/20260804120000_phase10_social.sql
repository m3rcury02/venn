-- Phase 10: public profiles, follows, visibility toggles, blocks.
--
-- This is the phase every earlier read policy was deferred to. Phase 0 wrote
-- "own row only" and named this phase; phase 3 widened to "own row or a shared-
-- group peer" and named this phase again for the visibility question. SPEC §3's
-- full read predicate lands here, in can_read_list().

-- ---------------------------------------------------------------- tables

create table follows (
  follower_id  uuid not null references profiles (id) on delete cascade,
  followee_id  uuid not null references profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_no_self check (follower_id <> followee_id)
);

-- The PK covers (follower_id, ...); this covers the other direction, which is
-- what "who follows me" reads.
create index follows_followee_id_idx on follows (followee_id);

create table blocks (
  blocker_id  uuid not null references profiles (id) on delete cascade,
  blocked_id  uuid not null references profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);

-- is_blocked_with() below probes both directions on every profile and list
-- read, so the reverse lookup needs its own index.
create index blocks_blocked_id_idx on blocks (blocked_id);

-- No UI this phase (see DECISIONS): the table exists because SPEC §3's read
-- predicate subtracts it, and that predicate is this phase's deliverable.
create table list_hidden_from (
  list_id  uuid not null references lists (id) on delete cascade,
  user_id  uuid not null references profiles (id) on delete cascade,
  primary key (list_id, user_id)
);

-- Discover browses public lists newest-first.
create index lists_public_idx on lists (created_at desc) where visibility = 'public';

-- ------------------------------------------------------------- functions

-- A block hides both directions. SECURITY DEFINER is mandatory, not stylistic:
-- blocks_select_own deliberately does not let you enumerate who blocked *you*,
-- so a plain subquery in a policy would see only half the rows and a block
-- would protect only the blocker.
--
-- One argument, reading auth.uid() internally, for the same reason
-- is_group_member(gid) takes only the group id (phase 3): a two-argument
-- version would be a relationship oracle any signed-in user could probe over
-- /rest/v1/rpc/. As written, the only question it answers is about the caller.
create function public.is_blocked_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks b
    where (b.blocker_id = (select auth.uid()) and b.blocked_id = other)
       or (b.blocker_id = other and b.blocked_id = (select auth.uid()))
  );
$$;

revoke execute on function public.is_blocked_with(uuid) from public, anon;
grant execute on function public.is_blocked_with(uuid) to authenticated;

-- SPEC §3's read predicate, stated exactly once and referenced by both the
-- lists and list_items SELECT policies.
--
-- SECURITY DEFINER is mandatory here too, for a different reason: this function
-- queries `lists` and is called from `lists`' own SELECT policy. As definer it
-- runs as the function owner (postgres), which bypasses RLS on a table it owns,
-- so the inner select does not re-enter the policy. Same mechanism
-- is_group_member() has relied on since phase 3.
--
-- A second consequence worth knowing: because every cross-table lookup
-- (follows, blocks, list_hidden_from, group_members) happens *inside* this
-- definer function, no widened policy contains a cross-table subquery of its
-- own. Nothing in this phase depends on how RLS treats tables referenced from
-- inside a policy expression.
create function public.can_read_list(lid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.lists l
    where l.id = lid
      and (
        -- mine
        l.owner_user_id = (select auth.uid())
        -- my group's
        or (l.owner_group_id is not null
            and public.is_group_member(l.owner_group_id))
        -- somebody else's, shared with me
        or (
          l.owner_user_id is not null
          and not public.is_blocked_with(l.owner_user_id)
          and not exists (
            select 1 from public.list_hidden_from h
            where h.list_id = l.id and h.user_id = (select auth.uid())
          )
          and (
            l.visibility = 'public'
            or (l.visibility = 'followers'
                and exists (
                  select 1 from public.follows f
                  where f.follower_id = (select auth.uid())
                    and f.followee_id = l.owner_user_id
                ))
          )
        )
      )
  );
$$;

revoke execute on function public.can_read_list(uuid) from public, anon;
grant execute on function public.can_read_list(uuid) to authenticated;

-- Blocking tears down both follow edges. The reverse edge -- them following you
-- -- is not deletable under follows_delete_own, so this has to be definer.
-- Unblocking needs no function: a plain DELETE policy covers it, because you
-- only ever delete a row you inserted.
create function public.block_user(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if target = me then
    raise exception 'cannot block yourself' using errcode = '42501';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (me, target)
  on conflict do nothing;

  delete from public.follows
  where (follower_id = me and followee_id = target)
     or (follower_id = target and followee_id = me);
end;
$$;

revoke execute on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

-- --------------------------------------------------------------- grants

-- Same two-gate reasoning as every earlier phase, and the same reason the
-- REVOKE is not redundant: hosted Supabase grants all DML on new tables by
-- default while a fresh local stack grants none.
revoke all on follows, blocks, list_hidden_from
  from anon, authenticated, service_role;

-- follows: you create and remove your own edges. No UPDATE -- the row carries
-- nothing that can change.
grant select, insert, delete on follows to authenticated;

-- blocks: no INSERT grant at all. block_user() is the only write path, because
-- inserting the row is only half the operation. Same "absence of a write grant
-- is the enforcement" argument phase 3 made for group_members.
grant select, delete on blocks to authenticated;

-- list_hidden_from: readable by the list's owner, written by nobody this phase.
grant select on list_hidden_from to authenticated;

-- ------------------------------------------------------------------ RLS

alter table follows          enable row level security;
alter table blocks           enable row level security;
alter table list_hidden_from enable row level security;

-- You read edges you are a party to. That is enough to render "Following" /
-- "Follows you" on a profile and your own following list, and it stops anyone
-- enumerating a stranger's audience. Public follower counts are not in SPEC §7
-- screen 8's scope.
create policy follows_select_own on follows
  for select to authenticated
  using ((select auth.uid()) in (follower_id, followee_id));

create policy follows_insert_own on follows
  for insert to authenticated
  with check (
    follower_id = (select auth.uid())
    and not public.is_blocked_with(followee_id)
  );

create policy follows_delete_own on follows
  for delete to authenticated
  using (follower_id = (select auth.uid()));

-- Own blocks, as blocker only. Who blocked *you* is deliberately unreadable --
-- that is exactly why is_blocked_with() had to be SECURITY DEFINER.
create policy blocks_select_own on blocks
  for select to authenticated
  using (blocker_id = (select auth.uid()));

create policy blocks_delete_own on blocks
  for delete to authenticated
  using (blocker_id = (select auth.uid()));

-- The list's owner. This subquery resolves against a row the caller can already
-- read under lists_select_visible (their own list), so it is correct under
-- either reading of how RLS treats a policy's referenced tables.
create policy list_hidden_from_select_owner on list_hidden_from
  for select to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_hidden_from.list_id
      and l.owner_user_id = (select auth.uid())
  ));

-- ------------------------------------------------------- widened policies

-- profiles: any signed-in user reads any profile, minus blocks. This is what
-- "public profiles" (§7 screen 8) and the Discover directory (§7 screen 9) both
-- need. The shared-group clause phase 3 added is now subsumed -- and note the
-- ordering: a block hides a group peer too, which is the intended meaning of a
-- block, at the cost of "added by" on a group page falling back to "Member".
--
-- Every profile column becomes readable this way, region and
-- default_list_visibility included. Accepted: they are preferences, not
-- secrets. See docs/DECISIONS.md phase 10.
drop policy profiles_select_visible on profiles;

create policy profiles_select_visible on profiles
  for select to authenticated
  using (
    (select auth.uid()) = id
    or not public.is_blocked_with(id)
  );

-- lists: the whole predicate now lives in can_read_list().
drop policy lists_select_visible on lists;

create policy lists_select_visible on lists
  for select to authenticated
  using (public.can_read_list(id));

-- list_items: SELECT widens with its parent list, and SELECT ONLY.
--
-- The three write policies are left byte-identical on purpose. Someone who can
-- READ your list because they follow you must not be able to add to it, remove
-- from it, or edit it. Do not touch list_items_insert_via_list (which also
-- carries the media_type clause from the TV migration),
-- list_items_update_via_list, or list_items_delete_via_list.
drop policy list_items_select_via_list on list_items;

create policy list_items_select_via_list on list_items
  for select to authenticated
  using (public.can_read_list(list_id));
