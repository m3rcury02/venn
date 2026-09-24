-- Abandoned remote-night lobbies expire after 12 hours. Closes the known gap
-- 20260809140000_remote_night_lobby.sql left open on purpose ("No auto-expiry
-- of an abandoned lobby", docs/DECISIONS.md) until real usage showed it
-- mattered. It matters before any strangers use the app, because the gap is
-- worse than that entry describes. It said an abandoned lobby "keeps blocking
-- a fresh one". In fact open_movie_night *returns* the open lobby instead of
-- refusing, so a group starting a remote night next Friday is sent into last
-- Friday's lobby, and last Friday's attendees count as present. The picker
-- then excludes films they have watched and scores for people who aren't there.
--
-- What "expired" means: open (closed_at is null) and opened more than 12
-- hours ago. held_at is the open time for a lobby: open_movie_night inserts it
-- with held_at's default now(), and close_movie_night never touches it. Twelve
-- hours covers a lobby started in the afternoon for an evening watch, and
-- makes sure next day's night starts fresh. There is no last-activity column
-- to measure from instead: movie_night_attendees has no joined_at, and adding
-- one for this would be a bigger change than the gap needs.
--
-- The same 12 hours lives in lib/lobby.ts (LOBBY_TTL_HOURS), which the night
-- page uses to stop showing an expired lobby. Two copies of one number is a
-- drift risk, and it's taken on knowingly: the alternative is routing the
-- page's two lobby reads through new RPCs just to share a constant. If one
-- changes, change both; supabase/tests/rls.test.sql pins this side.
--
-- Expired lobbies are deleted, not closed. Closing one would mean closed_at
-- set with picked_movie_id null, and the lobby migration already explains why
-- null can't mean "no pick yet": picked_movie_id is `on delete set null`, so
-- null already means "its movie left the catalog". A deleted lobby takes its
-- attendee rows with it (on delete cascade). It can't have watch_confirmations,
-- because request_watch_confirmations only runs after a pick. Nothing of
-- value is lost: nobody watched anything.
--
-- Expiry is lazy, not a cron. An expired lobby is harmless while it sits
-- there: the night page stops showing it, and join and close refuse it. It
-- only has to go when the group opens a new one, because the partial unique
-- index allows one open lobby per group. open_movie_night deletes it at
-- exactly that moment.
--
-- All three functions keep their signatures, so `create or replace` keeps
-- the existing grants (revoked from public and anon, granted to authenticated).

create or replace function public.open_movie_night(
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

  -- New in this migration. Runs after the membership check, so a non-member
  -- can't clear another group's lobby, and before the lookup below, so an
  -- expired lobby is never handed back as the one to join.
  delete from public.movie_nights
  where group_id = p_group_id
    and closed_at is null
    and held_at < now() - interval '12 hours';

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

-- Joining is always an explicit tap (see the component), never automatic on
-- page load: attendance here is what §8's watch confirmations fire against,
-- so auto-joining a member who only opened the link to peek would later ask
-- them to confirm they watched something they didn't.
create or replace function public.join_movie_night(
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
  night_held_at timestamptz;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select group_id, closed_at, held_at
  into night_group_id, night_closed_at, night_held_at
  from public.movie_nights
  where id = p_night_id;

  if night_group_id is null or not public.is_group_member(night_group_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  -- Attendance on a closed night is a watch claim, not a lobby seat --
  -- refuse rather than let a late joiner attach to an already-logged pick.
  -- An expired lobby is refused the same way, with the same message: to the
  -- person tapping "I'm in" on an old link, the two cases look identical.
  if night_closed_at is not null
     or night_held_at < now() - interval '12 hours' then
    raise exception 'this night is no longer open' using errcode = '42501';
  end if;

  insert into public.movie_night_attendees (movie_night_id, user_id)
  values (p_night_id, me)
  on conflict do nothing;
end;
$$;

-- Closes an open lobby with the group's pick. Deliberately does not touch
-- movie_night_attendees -- attendees joined themselves, and rewriting the
-- roster at close time would undo that.
create or replace function public.close_movie_night(
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
  night_held_at timestamptz;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_mode not in ('home', 'theatre') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;

  select closed_at, held_at into night_closed_at, night_held_at
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

  -- An expired lobby's roster is the one the picker must not trust (see the
  -- header), so a pick can't be logged against it either. The page stops
  -- rendering lobby mode for it at the same 12 hours, so reaching this means
  -- a tab left open across the cutoff. After a reload, the pick is logged as
  -- an ordinary night through log_movie_night.
  if night_held_at < now() - interval '12 hours' then
    raise exception 'this lobby has expired' using errcode = '42501';
  end if;

  update public.movie_nights
  set picked_movie_id = p_movie_id,
      mode = p_mode,
      closed_at = now()
  where id = p_night_id;
end;
$$;
