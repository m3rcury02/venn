-- joinable groups -- phase 3's note said "Deliberately NOT here: groups.visibility (invite|public) -- phase 12's 'joinable groups'".
--
-- Why groups' SELECT policy is NOT widened: phase 3's comment explains that a non-member cannot
-- select a group by its code because that would require a policy readable by everyone, exposing invite_code.
-- Widening groups_select_member to include visibility = 'public' would expose invite_code to everyone,
-- which stays valid even if an owner flips back to invite-only.
--
-- Therefore, the public directory is a SECURITY DEFINER function public_groups() that returns
-- name and member count and NEVER the invite code.

create type group_visibility as enum ('invite', 'public');

-- Default 'invite' so every existing group keeps exactly the behaviour it
-- has today; going public is an explicit owner action.
alter table groups add column visibility group_visibility not null default 'invite';

-- Mirrors lists_public_idx (phase 10): the directory browses newest-first.
create index groups_public_idx on groups (created_at desc) where visibility = 'public';

-- Returns public groups for directory browsing.
-- Omitting invite_code from the return type is the whole point: non-members cannot read invite codes.
create function public.public_groups(p_limit int default 20)
returns table (
  id           uuid,
  name         text,
  member_count bigint,
  created_at   timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    g.id,
    g.name,
    count(m.user_id) as member_count,
    g.created_at
  from public.groups g
  left join public.group_members m on m.group_id = g.id
  where g.visibility = 'public'
  group by g.id, g.name, g.created_at
  order by g.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke execute on function public.public_groups(int) from public, anon;
grant execute on function public.public_groups(int) to authenticated;

-- Instantly joins a public group.
create function public.join_public_group(p_group_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_gid uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select id into v_gid
    from public.groups
   where id = p_group_id and visibility = 'public';

  if v_gid is null then
    return null;
  end if;

  insert into public.group_members (group_id, user_id)
  values (v_gid, v_uid)
  on conflict do nothing;

  return v_gid;
end;
$$;

revoke execute on function public.join_public_group(uuid) from public, anon;
grant execute on function public.join_public_group(uuid) to authenticated;

-- Updates group visibility (owner only).
-- This is a function and NOT an UPDATE grant on groups because phase 3's grants comment
-- states that the absent UPDATE grant is what keeps renaming a group out of scope.
-- A table-level UPDATE grant would silently reverse that decision.
create function public.set_group_visibility(
  p_group_id uuid,
  p_visibility public.group_visibility
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.groups
     set visibility = p_visibility
   where id = p_group_id and created_by = v_uid;

  return found;
end;
$$;

revoke execute on function public.set_group_visibility(uuid, public.group_visibility) from public, anon;
grant execute on function public.set_group_visibility(uuid, public.group_visibility) to authenticated;

-- Deliberately NO changes to grants or policies on groups or group_members.
-- RLS policies remain strict; public visibility is handled exclusively by the definer RPCs above.
