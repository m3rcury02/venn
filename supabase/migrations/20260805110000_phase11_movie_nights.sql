-- Phase 11: Movie nights & watch confirmations.
--
-- SPEC §3: tables `movie_nights`, `movie_night_attendees`, and `watch_confirmations`.
-- SPEC §8: watch confirmation flow.

-- ---------------------------------------------------------------- tables

create table movie_nights (
  id              uuid primary key default gen_random_uuid(),
  group_id        uuid not null references groups (id) on delete cascade,
  mode            text not null check (mode in ('home','theatre')),
  held_at         timestamptz not null default now(),
  -- picked_movie_id is ON DELETE SET NULL rather than CASCADE so night records
  -- persist even if a movie catalog row is deleted or modified.
  picked_movie_id uuid references movies (id) on delete set null,
  created_by      uuid not null references profiles (id) on delete cascade
);

create index movie_nights_group_idx on movie_nights (group_id, held_at desc);

create table movie_night_attendees (
  movie_night_id uuid not null references movie_nights (id) on delete cascade,
  user_id        uuid not null references profiles (id) on delete cascade,
  primary key (movie_night_id, user_id)
);

create index movie_night_attendees_user_idx on movie_night_attendees (user_id);

create table watch_confirmations (
  movie_night_id uuid not null references movie_nights (id) on delete cascade,
  user_id        uuid not null references profiles (id) on delete cascade,
  status         text not null default 'pending'
                 check (status in ('pending','confirmed','declined')),
  primary key (movie_night_id, user_id)
);

-- ------------------------------------------------------------- functions

create function public.log_movie_night(
  p_group_id uuid,
  p_mode text,
  p_movie_id uuid,
  p_present uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  new_night_id uuid;
begin
  if me is null or not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  if p_mode not in ('home', 'theatre') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;

  insert into public.movie_nights (group_id, mode, picked_movie_id, created_by)
  values (p_group_id, p_mode, p_movie_id, me)
  returning id into new_night_id;

  -- Only insert attendees who are genuinely confirmed members of the group
  insert into public.movie_night_attendees (movie_night_id, user_id)
  select new_night_id, gm.user_id
  from public.group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = any(p_present);

  return new_night_id;
end;
$$;

revoke execute on function public.log_movie_night(uuid, text, uuid, uuid[]) from public, anon;
grant execute on function public.log_movie_night(uuid, text, uuid, uuid[]) to authenticated;

create function public.request_watch_confirmations(
  p_night_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  is_attendee boolean;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.movie_night_attendees
    where movie_night_id = p_night_id and user_id = me
  ) into is_attendee;

  if not is_attendee then
    raise exception 'not an attendee of this night' using errcode = '42501';
  end if;

  -- Set caller's own status to confirmed
  insert into public.watch_confirmations (movie_night_id, user_id, status)
  values (p_night_id, me, 'confirmed')
  on conflict (movie_night_id, user_id) do update set status = 'confirmed';

  -- Create pending confirmation requests for all other attendees
  insert into public.watch_confirmations (movie_night_id, user_id, status)
  select p_night_id, mna.user_id, 'pending'
  from public.movie_night_attendees mna
  where mna.movie_night_id = p_night_id
    and mna.user_id <> me
  on conflict do nothing;
end;
$$;

revoke execute on function public.request_watch_confirmations(uuid) from public, anon;
grant execute on function public.request_watch_confirmations(uuid) to authenticated;

-- --------------------------------------------------------------- grants

revoke all on movie_nights, movie_night_attendees, watch_confirmations
  from anon, authenticated, service_role;

grant select on movie_nights, movie_night_attendees to authenticated;
grant select, update on watch_confirmations to authenticated;

-- WP6 digest reads movie_nights & movie_night_attendees via service_role client
grant select on movie_nights, movie_night_attendees to service_role;

-- ------------------------------------------------------------------ RLS

alter table movie_nights           enable row level security;
alter table movie_night_attendees  enable row level security;
alter table watch_confirmations    enable row level security;

create policy movie_nights_select_member on movie_nights
  for select to authenticated
  using (public.is_group_member(group_id));

create policy movie_night_attendees_select_member on movie_night_attendees
  for select to authenticated
  using (exists (
    select 1 from movie_nights n
    where n.id = movie_night_attendees.movie_night_id
      and public.is_group_member(n.group_id)
  ));

create policy watch_confirmations_select_own on watch_confirmations
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy watch_confirmations_update_own on watch_confirmations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
