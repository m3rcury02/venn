-- Phase 3: groups, invite codes, group lists, multi-user RLS.
--
-- The first phase where more than one person touches the same row. Phases 0-2
-- are single-user by construction: every policy reduces to `x = auth.uid()`,
-- and profiles_select_own means a user cannot see that anyone else exists.
-- This migration widens profiles/lists/list_items to "my groups too", and
-- performs the lists ALTER phase 0 explicitly deferred to here.
--
-- Deliberately NOT here: groups.visibility (invite|public) -- phase 12's
-- "joinable groups" widens a policy, not the schema, and phase 0's precedent is
-- not to carry a column that can never take its second value. Leaving,
-- renaming and deleting a group are likewise out of scope, and the absent
-- UPDATE/DELETE grants below are what keep that true.

-- ----------------------------------------------------------------- groups

create type group_role as enum ('owner', 'member');

create table groups (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- gen_random_uuid() is core Postgres, so nothing here needs an `extensions.`
  -- prefix that the search_path = '' functions below would get wrong. 8 hex
  -- chars is ~4.3e9 codes; the unique constraint is the collision backstop and
  -- there is deliberately no retry loop.
  invite_code  text not null unique
               default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  created_by   uuid not null references profiles (id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table group_members (
  group_id   uuid not null references groups (id) on delete cascade,
  user_id    uuid not null references profiles (id) on delete cascade,
  role       group_role not null default 'member',
  joined_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_id_idx on group_members (user_id);

-- ------------------------------------------------------------ group lists

-- Phase 0 left this ALTER for phase 3 by name: it *is* "group lists".
alter table lists alter column owner_user_id drop not null;

alter table lists add column owner_group_id uuid references groups (id) on delete cascade;

alter table lists add constraint lists_one_owner
  check (num_nonnulls(owner_user_id, owner_group_id) = 1);

create index lists_owner_group_id_idx on lists (owner_group_id);

-- Required, not redundant: lists_one_default_per_owner_idx is
-- `on lists (owner_user_id) where is_default`, and NULLs are distinct in a
-- unique index, so it stops enforcing anything the moment owner_user_id is
-- nullable. Group lists carry is_default = false (see handle_new_group), so
-- uniqueness for them has to come from the group column instead.
create unique index lists_one_per_group_idx
  on lists (owner_group_id) where owner_group_id is not null;

-- -------------------------------------------------------------- functions

-- The recursion break. A group_members SELECT policy that itself queries
-- group_members recurses forever; SECURITY DEFINER short-circuits that.
--
-- One argument, reading auth.uid() internally, on purpose: a (gid, uid)
-- signature would make this a membership oracle any authenticated user could
-- probe. Unlike handle_new_user (revoked from everyone -- only a trigger calls
-- it), this one needs EXECUTE for authenticated, because policies are
-- evaluated as the invoking role.
create function public.is_group_member(gid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_group_member(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated;

-- Mirrors phase 0's handle_new_user: a new group arrives with its creator as
-- owner and its one list already created. Making this a trigger rather than a
-- second insert from the server action is what lets group_members carry no
-- INSERT policy and no INSERT grant at all -- the same "no write policy is the
-- enforcement" argument phase 0 made for the catalog tables.
--
-- is_default is false: `/` resolves "the user's list" and a second is_default
-- row reachable through the widened lists policy would break that .single().
create function public.handle_new_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.created_by, 'owner');

  insert into public.lists (name, owner_user_id, owner_group_id, is_default)
  values (new.name, null, new.id, false);

  return new;
end;
$$;

revoke execute on function public.handle_new_group() from public, anon, authenticated;

create trigger on_group_created
  after insert on groups
  for each row execute function public.handle_new_group();

-- The other write path into group_members. A non-member cannot select a group
-- by its code -- that would need a policy readable by everyone, which is
-- exactly what the invite code is meant to avoid -- so joining has to be
-- SECURITY DEFINER. Returns the group id, or null when no code matches.
create function public.join_group_by_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_gid uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id into v_gid from public.groups
  where invite_code = upper(trim(p_code));

  if v_gid is null then
    return null;
  end if;

  insert into public.group_members (group_id, user_id)
  values (v_gid, v_uid)
  on conflict do nothing;

  return v_gid;
end;
$$;

revoke execute on function public.join_group_by_code(text) from public, anon;
grant execute on function public.join_group_by_code(text) to authenticated;

-- --------------------------------------------------------------- grants

-- Same two-gate reasoning as phase 0, and the same reason the REVOKE is not
-- redundant: hosted Supabase grants all DML on new tables by default while a
-- fresh local stack grants none. Revoking first makes both ends identical.
--
-- No UPDATE or DELETE for anyone: renaming, leaving and deleting groups are
-- out of scope this phase, and withholding the grant is how that stays true.
-- group_members gets no INSERT either -- both write paths are the SECURITY
-- DEFINER functions above.

revoke all on groups, group_members from anon, authenticated, service_role;

grant select, insert on groups to authenticated;
grant select on group_members to authenticated;

-- ------------------------------------------------------------------ RLS

alter table groups        enable row level security;
alter table group_members enable row level security;

-- Membership is the whole read gate: a non-member gets no row, so they cannot
-- read the group's name or, more to the point, its invite code.
create policy groups_select_member on groups
  for select to authenticated
  using (public.is_group_member(id));

create policy groups_insert_own on groups
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy group_members_select_peers on group_members
  for select to authenticated
  using (public.is_group_member(group_id));

-- ------------------------------------------------------- widened policies

-- profiles: own row, or somebody who shares a group with the caller. Without
-- this the group list cannot render "who added what" at all. Note it exposes
-- every profile column to group peers, default_list_visibility included.
drop policy profiles_select_own on profiles;

create policy profiles_select_visible on profiles
  for select to authenticated
  using (
    (select auth.uid()) = id
    or exists (
      select 1 from group_members m
      where m.user_id = profiles.id and public.is_group_member(m.group_id)
    )
  );

-- lists: own, or owned by a group the caller belongs to.
--
-- lists_insert_own / _update_own / _delete_own are left exactly as phase 0
-- wrote them. `auth.uid() = owner_user_id` is NULL -- therefore false -- for a
-- group list, so group lists can only be created by handle_new_group and only
-- die by cascade when the group does.
drop policy lists_select_own on lists;

create policy lists_select_visible on lists
  for select to authenticated
  using (
    (select auth.uid()) = owner_user_id
    or (owner_group_id is not null and public.is_group_member(owner_group_id))
  );

-- list_items: the parent-list join phase 0 flagged as the predicate this phase
-- rewrites. Same widening on all four, and the insert keeps
-- `added_by = auth.uid()` -- that clause is what makes "who added what"
-- trustworthy; without it a member could attribute an add to someone else.
drop policy list_items_select_via_list on list_items;
drop policy list_items_insert_via_list on list_items;
drop policy list_items_update_via_list on list_items;
drop policy list_items_delete_via_list on list_items;

create policy list_items_select_via_list on list_items
  for select to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id
      and (l.owner_user_id = (select auth.uid())
           or (l.owner_group_id is not null and public.is_group_member(l.owner_group_id)))
  ));

create policy list_items_insert_via_list on list_items
  for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and exists (
      select 1 from lists l
      where l.id = list_items.list_id
        and (l.owner_user_id = (select auth.uid())
             or (l.owner_group_id is not null and public.is_group_member(l.owner_group_id)))
    )
  );

create policy list_items_update_via_list on list_items
  for update to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id
      and (l.owner_user_id = (select auth.uid())
           or (l.owner_group_id is not null and public.is_group_member(l.owner_group_id)))
  ))
  with check (exists (
    select 1 from lists l
    where l.id = list_items.list_id
      and (l.owner_user_id = (select auth.uid())
           or (l.owner_group_id is not null and public.is_group_member(l.owner_group_id)))
  ));

-- Any member can remove any member's addition. A decision, not an oversight:
-- at 4-6 friends a per-adder delete rule buys friction, not safety.
create policy list_items_delete_via_list on list_items
  for delete to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id
      and (l.owner_user_id = (select auth.uid())
           or (l.owner_group_id is not null and public.is_group_member(l.owner_group_id)))
  ));

-- user_movie_status is deliberately NOT widened. SPEC §11: a user must not read
-- another's private ratings. Phase 4's recommender reads them server-side; that
-- is phase 4's problem, not a reason to open the table now.
