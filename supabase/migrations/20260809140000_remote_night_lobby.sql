-- SPEC §4.5's last unbuilt edge case: "Remote nights: a lobby with a join
-- link; movie_night_attendees fills as people join." Closed out of band
-- against phase 4, same as §4.2's widen step and §4.5's "None of these"
-- logging were.
--
-- `movie_night_attendees` FKs to `movie_nights`, so the spec's "fills as
-- people join" forces the night row to exist before the pick, not after --
-- the inverse of log_movie_night's current insert-both-at-once. This
-- migration gives movie_nights a lifecycle: open (closed_at null) while the
-- lobby is live, closed once a pick is logged.

alter table movie_nights add column closed_at timestamptz default now();

-- Backfill honestly rather than leaving add-column's now() stamped on
-- pre-existing rows -- held_at is that row's real close time.
update movie_nights set closed_at = held_at;

-- One open lobby per group at a time. Also what makes open_movie_night's
-- "return the existing lobby" behaviour below correct rather than racy.
create unique index movie_nights_one_open_lobby_idx
  on movie_nights (group_id) where closed_at is null;

-- --------------------------------------------------------------- functions

-- Starts a remote night, or hands back the one already open for this group.
-- Returning the existing id rather than raising on the unique index above
-- matters: two members tapping "Start a remote night" within a second of
-- each other is the normal case, not a conflict to surface.
create function public.open_movie_night(
  p_group_id uuid,
  p_mode text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  existing_id uuid;
  new_night_id uuid;
begin
  if me is null or not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  if p_mode not in ('home', 'theatre') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;

  select id into existing_id
  from public.movie_nights
  where group_id = p_group_id and closed_at is null;

  if existing_id is not null then
    return existing_id;
  end if;

  insert into public.movie_nights (group_id, mode, created_by, closed_at)
  values (p_group_id, p_mode, me, null)
  returning id into new_night_id;

  insert into public.movie_night_attendees (movie_night_id, user_id)
  values (new_night_id, me);

  return new_night_id;
end;
$$;

revoke execute on function public.open_movie_night(uuid, text) from public, anon;
grant execute on function public.open_movie_night(uuid, text) to authenticated;

-- Joining is always an explicit tap (see the component), never automatic on
-- page load: attendance here is what §8's watch confirmations fire against,
-- so auto-joining a member who only opened the link to peek would later ask
-- them to confirm they watched something they didn't.
create function public.join_movie_night(
  p_night_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  night_group_id uuid;
  night_closed_at timestamptz;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select group_id, closed_at into night_group_id, night_closed_at
  from public.movie_nights
  where id = p_night_id;

  if night_group_id is null or not public.is_group_member(night_group_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  -- Attendance on a closed night is a watch claim, not a lobby seat --
  -- refuse rather than let a late joiner attach to an already-logged pick.
  if night_closed_at is not null then
    raise exception 'this night is no longer open' using errcode = '42501';
  end if;

  insert into public.movie_night_attendees (movie_night_id, user_id)
  values (p_night_id, me)
  on conflict do nothing;
end;
$$;

revoke execute on function public.join_movie_night(uuid) from public, anon;
grant execute on function public.join_movie_night(uuid) to authenticated;

-- Closes an open lobby with the group's pick. Deliberately does not touch
-- movie_night_attendees -- attendees joined themselves, and rewriting the
-- roster at close time would undo that.
create function public.close_movie_night(
  p_night_id uuid,
  p_movie_id uuid,
  p_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  is_attendee boolean;
  night_closed_at timestamptz;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_mode not in ('home', 'theatre') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;

  select closed_at into night_closed_at
  from public.movie_nights
  where id = p_night_id;

  select exists (
    select 1 from public.movie_night_attendees
    where movie_night_id = p_night_id and user_id = me
  ) into is_attendee;

  if not is_attendee then
    raise exception 'not an attendee of this night' using errcode = '42501';
  end if;

  if night_closed_at is not null then
    raise exception 'this night is already closed' using errcode = '42501';
  end if;

  update public.movie_nights
  set picked_movie_id = p_movie_id,
      mode = p_mode,
      closed_at = now()
  where id = p_night_id;
end;
$$;

revoke execute on function public.close_movie_night(uuid, uuid, text) from public, anon;
grant execute on function public.close_movie_night(uuid, uuid, text) to authenticated;

-- No new tables, so no new grants and no new RLS policies:
-- movie_nights_select_member and movie_night_attendees_select_member already
-- cover reading an open lobby and its roster.
