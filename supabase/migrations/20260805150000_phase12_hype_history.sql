-- hype_history -- phase 0's note said "-> 4", but phase 4 scored current hype off
-- user_movie_status and never read history. Its first consumer is phase 12's hype-vs-reality
-- stats.
--
-- Why history cannot be derived from user_movie_status: setWatched() in app/status/actions.ts
-- clears both hype and rating columns when watched flips, destroying the hype a user felt
-- before watching the moment it becomes checkable. Recording predictions in hype_history
-- when they are made preserves this data.

create table hype_history (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles (id) on delete cascade,
  movie_id         uuid not null references movies (id) on delete cascade,
  hype             movie_hype not null,
  recorded_at      timestamptz not null default now(),
  resolved_rating  movie_rating
);

-- Partial unique index ensures at most one open (unresolved) prediction exists per (user, movie) pair.
-- Re-voting hype before watching replaces the open prediction rather than adding a second.
create unique index hype_history_one_open_idx
  on hype_history (user_id, movie_id) where resolved_rating is null;

create index hype_history_user_idx on hype_history (user_id, recorded_at desc);

create function public.record_hype_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_hype   public.movie_hype;
  v_prev_rating public.movie_rating;
begin
  -- old is unassigned on INSERT (onboarding's 10 ratings, import processing).
  if tg_op = 'UPDATE' then
    v_prev_hype   := old.hype;
    v_prev_rating := old.rating;
  end if;

  -- The prediction. Re-voting before watching replaces the open row rather
  -- than opening a second one -- hype_history_one_open_idx enforces that.
  if new.hype is not null and new.hype is distinct from v_prev_hype then
    update public.hype_history
       set hype = new.hype, recorded_at = now()
     where user_id = new.user_id
       and movie_id = new.movie_id
       and resolved_rating is null;

    if not found then
      insert into public.hype_history (user_id, movie_id, hype)
      values (new.user_id, new.movie_id, new.hype);
    end if;
  end if;

  -- The reality. Resolves the most recent prediction for this pair, whether
  -- or not it was already resolved -- deliberately NOT `where resolved_rating
  -- is null`. A user who rates `like` and later changes it to `love` would
  -- otherwise leave history stuck on `like`, and /stats would contradict the
  -- rating their own list is showing. Creates nothing when there is no
  -- prediction: rating a film you never hyped is not a data point.
  if new.rating is not null and new.rating is distinct from v_prev_rating then
    update public.hype_history
       set resolved_rating = new.rating
     where id = (
       select h.id from public.hype_history h
        where h.user_id = new.user_id and h.movie_id = new.movie_id
        order by h.recorded_at desc
        limit 1
     );
  end if;

  return null;  -- after trigger; return value is ignored
end;
$$;

-- Same hardening as handle_new_user (phase 0): Postgres grants EXECUTE to
-- PUBLIC by default, which would make this a callable endpoint for anon.
revoke execute on function public.record_hype_history() from public, anon, authenticated;

create trigger on_status_vote
  after insert or update on user_movie_status
  for each row execute function public.record_hype_history();

-- Backfill open predictions from live user_movie_status rows. Resolved predictions
-- cannot be backfilled because setWatched() previously cleared hype when watched flipped.
insert into hype_history (user_id, movie_id, hype, recorded_at)
select user_id, movie_id, hype, updated_at
from user_movie_status
where hype is not null;

-- Grants: SECURITY DEFINER trigger is the only write path. authenticated gets SELECT only.
revoke all on hype_history from anon, authenticated, service_role;
grant select on hype_history to authenticated;

alter table hype_history enable row level security;

create policy hype_history_select_own on hype_history
  for select to authenticated
  using ((select auth.uid()) = user_id);
