-- Leaving a remote-night lobby. Closes the last gap the lobby entries in
-- docs/DECISIONS.md recorded as open ("no 'leave the lobby'", under
-- "Remote-night lobbies expire after 12 hours").
--
-- Why it can't wait for real usage, as the other lobby gaps did: since
-- 20260925063651_public_group_nights.sql, joining a lobby is the consent step
-- in any group that has ever been public. _assert_night_consent lets the
-- picker score a member only while they are an attendee of the open lobby,
-- and "I'm in" is the tap that makes them one. Until now that consent could
-- be given but not withdrawn: a member who tapped "I'm in" by mistake, or
-- changed their mind, stayed in the roster -- their taste in every pick,
-- their hype readable from the counts by the other attendees (that entry's
-- "Still true after this") -- for up to the full 12 hours. Withdrawing
-- consent should be as easy as giving it, and this is the button for it.
--
-- The rules, and why each one:
--
-- * Only your own seat. The function deletes `user_id = auth.uid()` and
--   nothing else; there is no p_user_id, so nobody can remove anyone else.
--
-- * Open lobbies only. On a closed night, attendance stops being a lobby
--   seat and becomes the record of who watched the pick: it is what
--   request_watch_confirmations fired against (SPEC §8) and what the digest
--   and stats read. Leaving after the fact would rewrite that history, so a
--   closed night refuses, with the same message join_movie_night uses.
--
-- * An expired lobby may be left. It is inert already (unjoinable,
--   unclosable, hidden by the page), so removing yourself from it changes
--   nothing anyone can see, and refusing would only be confusing.
--
-- * The last one out deletes the lobby. An open lobby with nobody in it
--   would still occupy the group's one open-lobby slot (the partial unique
--   index from 20260809140000_remote_night_lobby.sql), so the next person to
--   start a remote night would be handed an empty room they're not in.
--   Deleting is safe for the same reasons 20260924130000_lobby_expiry.sql
--   gives for deleting expired lobbies: no pick has been made, so there are
--   no watch confirmations, and attendee rows cascade.
--
-- * Not a member: refused, like join. Not an attendee: a no-op, so a double
--   tap or a stale tab doesn't surface an error for an outcome that already
--   holds.
--
-- SECURITY DEFINER because movie_night_attendees has no DELETE grant or
-- policy for authenticated -- every write to it goes through a function, the
-- same as join_movie_night. Same hardening as every other definer function
-- here: empty search_path, schema-qualified names, EXECUTE revoked from
-- public and anon and granted to authenticated only.

create function public.leave_movie_night(
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

  select group_id
  into night_group_id
  from public.movie_nights
  where id = p_night_id;

  -- A missing night and another group's night answer identically, so this
  -- can't be used to probe which night ids exist. Checked before taking the
  -- lock below, so a non-member can't hold another group's lobby row.
  if night_group_id is null or not public.is_group_member(night_group_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  -- Lock the night row before touching the roster. Without it, the last two
  -- attendees leaving at the same moment each delete their own (different)
  -- row, each still see the other's uncommitted row in the check below, and
  -- an empty lobby survives. With it, the second waits for the first to
  -- commit, and its next statement sees the roster as the first left it.
  -- join_movie_night's insert needs a key-share lock on this same row for
  -- its foreign key, so a join racing the last leave waits too.
  select closed_at
  into night_closed_at
  from public.movie_nights
  where id = p_night_id
  for update;

  if not found then
    -- Deleted between the two reads: the last attendee left first.
    return;
  end if;

  if night_closed_at is not null then
    raise exception 'this night is no longer open' using errcode = '42501';
  end if;

  delete from public.movie_night_attendees
  where movie_night_id = p_night_id and user_id = me;

  if not exists (
    select 1 from public.movie_night_attendees where movie_night_id = p_night_id
  ) then
    delete from public.movie_nights where id = p_night_id;
  end if;
end;
$$;

revoke execute on function public.leave_movie_night(uuid) from public, anon;
grant execute on function public.leave_movie_night(uuid) to authenticated;
