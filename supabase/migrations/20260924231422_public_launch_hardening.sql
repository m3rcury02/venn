-- Public-launch hardening. Four decisions that were right for "4-6 friends"
-- (SPEC's private build) and stop being right the day strangers can sign up.
-- docs/DECISIONS.md, "Public-launch hardening", has the longer reasoning.
--
--   1. Group list items: only the adder or the group's creator may remove or
--      edit one. Phase 3 let any member remove any addition; phase 12 then
--      made public groups instantly joinable, so together one stranger could
--      empty a public group's list in a single request.
--   2. Per-user rate limits (rate_limit_hits + consume_rate_limit), for every
--      path where a request makes the server call TMDB. Before this only
--      /api/ingest was limited, so one account could use up the whole app's
--      shared TMDB quota.
--   3. An 18+ confirmation (profiles.age_confirmed_at). India's DPDP Act
--      treats everyone under 18 as a child whose data needs verifiable
--      parental consent. Venn doesn't collect that consent, so it is 18+ and
--      onboarding cannot complete without the confirmation.
--   4. log_movie_night is rate limited. Each call makes every "present"
--      member a watch-confirmation target, so in a public group it was an
--      unbounded way to spam strangers.

-- --------------------------------------------- 1. group list item ownership

-- Deleting: the item's own list owner (a personal list); or, on a group list,
-- the member who added it or the group's creator. The creator is the only
-- moderator a group has: without that clause, an item whose adder never
-- returns could never be removed. created_by rather than a role = 'owner'
-- join, for the reason 20260728093117_group_delete.sql gives: it's on the
-- row, and there's no ownership transfer to make it go stale. A member can
-- read their group's row (groups_select_member), so this subquery needs no
-- SECURITY DEFINER.
--
-- A departed adder's items are still covered: added_by is `on delete cascade`
-- to profiles, but leaving a group deletes only the group_members row, so the
-- item stays and the creator can remove it.
drop policy list_items_delete_via_list on list_items;

create policy list_items_delete_via_list on list_items
  for delete to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id
      and (
        l.owner_user_id = (select auth.uid())
        or (
          l.owner_group_id is not null
          and public.is_group_member(l.owner_group_id)
          and (
            list_items.added_by = (select auth.uid())
            or exists (
              select 1 from groups g
              where g.id = l.owner_group_id
                and g.created_by = (select auth.uid())
            )
          )
        )
      )
  ));

-- Updating: the adder only, including the creator. The update grant is
-- table-wide (phase 0), so this policy is what stops a member rewriting
-- someone else's note, or moving someone else's item to another film. No
-- creator clause here: removal is the moderation tool, and editing
-- another person's words is not. The WITH CHECK keeps the TV-title rule
-- 20260727200002_media_type_tv.sql added and pins added_by, so an adder
-- can't hand their item to someone else either.
drop policy list_items_update_via_list on list_items;

create policy list_items_update_via_list on list_items
  for update to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id
      and (
        l.owner_user_id = (select auth.uid())
        or (
          l.owner_group_id is not null
          and public.is_group_member(l.owner_group_id)
          and list_items.added_by = (select auth.uid())
        )
      )
  ))
  with check (
    exists (
      select 1 from lists l
      where l.id = list_items.list_id
        and (
          l.owner_user_id = (select auth.uid())
          or (
            l.owner_group_id is not null
            and public.is_group_member(l.owner_group_id)
            and list_items.added_by = (select auth.uid())
          )
        )
    )
    and (
      exists (
        select 1 from lists l
        where l.id = list_items.list_id and l.owner_group_id is null
      )
      or exists (
        select 1 from movies m
        where m.id = list_items.movie_id and m.media_type = 'movie'
      )
    )
  );

-- ------------------------------------------------------ 2. rate limiting

-- Fixed windows, one row per (user, bucket, window). The function below
-- deletes a user's older windows for a bucket on each call, so the table holds
-- at most one row per user per bucket rather than growing with traffic.
--
-- A fixed window can let up to 2x the budget through across a boundary. That's
-- fine here: the goal is to stop one account using up TMDB's quota, not to
-- meter exact usage, and a sliding log would store a row per request.
--
-- Postgres rather than memory: a Vercel function instance is per request, so
-- an in-memory counter would reset constantly and never be shared.
create table rate_limit_hits (
  user_id      uuid        not null references profiles (id) on delete cascade,
  bucket       text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (user_id, bucket, window_start)
);

-- No policies and no grants: consume_rate_limit is the only path in, the
-- same "no write policy is the enforcement" argument phase 0 made for the
-- catalog tables. RLS is still enabled, so a grant added by mistake later
-- exposes nothing.
alter table rate_limit_hits enable row level security;
revoke all on rate_limit_hits from anon, authenticated, service_role;

-- The budgets live here, not in the app, so a caller can't choose its own
-- limit, and an unknown bucket is an error rather than a row. Each one is sized
-- well above what a person does by hand. The point is to stop scripts:
--
--   search   60 / min   one TMDB call each; the search box is debounced
--   catalog  100 / 10m  a title Venn hasn't cached yet: 2 TMDB calls each
--   feed     30 / min   Explore and onboarding pages, up to ~25 calls each
--   detail   120 / min  a movie page's live availability (2 calls)
--   widen    20 / min   a group night's widen step
--   import   120 / min  one import row (1 search + up to 3 titles)
--   night    10 / hour  logging a movie night (watch-confirmation fan-out)
--
-- Per user, not global. A global cap would let one abusive account lock
-- everybody else out, which is the failure this is meant to prevent. What it
-- doesn't stop is one person running many accounts. That needs
-- signup-level controls (captcha, per-IP limits at the edge) and is recorded
-- as open in docs/DECISIONS.md.
create function public.consume_rate_limit(p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_max int;
  v_window_seconds int;
  v_window_start timestamptz;
  v_hits int;
begin
  if me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select b.max_hits, b.window_seconds into v_max, v_window_seconds
  from (values
    ('search',  60,  60),
    ('catalog', 100, 600),
    ('feed',    30,  60),
    ('detail',  120, 60),
    ('widen',   20,  60),
    ('import',  120, 60),
    ('night',   10,  3600)
  ) as b (bucket, max_hits, window_seconds)
  where b.bucket = p_bucket;

  if v_max is null then
    raise exception 'unknown rate limit bucket' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds
  );

  insert into public.rate_limit_hits (user_id, bucket, window_start, hits)
  values (me, p_bucket, v_window_start, 1)
  on conflict (user_id, bucket, window_start)
    do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;

  delete from public.rate_limit_hits
  where user_id = me and bucket = p_bucket and window_start < v_window_start;

  return v_hits <= v_max;
end;
$$;

revoke execute on function public.consume_rate_limit(text)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_rate_limit(text) to authenticated;

-- ------------------------------------------------ 3. 18+ age confirmation

-- A timestamp, not a boolean: it records *when* the user said they were 18 or
-- over, which is what an audit would ask for. Not in the column-scoped update
-- grant phase 8 set up, so it can only be set through confirm_age() --
-- the same arrangement as onboarded_at and complete_onboarding().
alter table public.profiles add column age_confirmed_at timestamptz;

create function public.confirm_age()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- coalesce: confirming twice keeps the first timestamp.
  update public.profiles
  set age_confirmed_at = coalesce(age_confirmed_at, now())
  where id = v_uid;
end;
$$;

revoke execute on function public.confirm_age()
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_age() to authenticated;

-- 20260808000000_onboarding_five_rating_minimum.sql's version, plus the age
-- check. The app gates on this too (lib/supabase/proxy.ts), but onboarded_at
-- is what the proxy caches in a cookie, so the database refuses to set it
-- without the confirmation. Same signature, so `create or replace` keeps the
-- grants.
--
-- Users who onboarded before this migration keep their onboarded_at and are
-- sent back to the age step by the proxy, which checks both columns.
create or replace function public.complete_onboarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and p.age_confirmed_at is not null
  ) then
    raise exception 'age confirmation required' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = v_uid
      and p.username is not null
      and p.region ~ '^[A-Z]{2}$'
  ) then
    raise exception 'profile incomplete' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.user_movie_status s
    where s.user_id = v_uid and s.rating is not null
  ) < 5 then
    raise exception 'five ratings required' using errcode = '22023';
  end if;

  perform public._rebuild_tag_weights(v_uid);

  update public.profiles
  set onboarded_at = coalesce(onboarded_at, now())
  where id = v_uid;
end;
$$;

-- ------------------------------------------- 4. log_movie_night rate limit

-- 20260805110000_phase11_movie_nights.sql's version, plus the rate limit.
-- It goes in the database rather than in app/groups/[id]/night/actions.ts
-- because the RPC is callable directly: an app-only check would limit the
-- push notifications but not the watch-confirmation rows. The limit is
-- checked after the membership check, so a non-member's failed call doesn't
-- use up budget. Same signature, so the grants carry over.
create or replace function public.log_movie_night(
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

  if not public.consume_rate_limit('night') then
    raise exception 'too many movie nights logged, try again later'
      using errcode = 'P0429';
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
