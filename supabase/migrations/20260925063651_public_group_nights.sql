-- Two gaps "Public-launch hardening" (docs/DECISIONS.md) left open, both in
-- the movie-night picker, both only reachable once phase 12 made public groups
-- instantly joinable.
--
-- 1. Taste inference in public groups.
--
--    The hardening entry framed this as "a stranger who joins a public group
--    and marks only themselves and one member present can read that member's
--    hype from the count", and suggested hiding counts below 3 present. That
--    fix is too narrow. `present` is whatever the caller passes, so a stranger
--    can pass the victim *alone*:
--      - the picks are then the victim's own ranking of the group list, and
--        explain() words it "You're hyped for this" / "You love <person>";
--      - rerolling until "That's everything" enumerates every group-list film
--        the victim has NOT watched, because candidates exclude anything a
--        present member watched -- the complement is their watch history;
--      - widen_seeds hands back the victim's top-rated films on the list.
--    And even without marking the victim present, seen_count counts every
--    group member, so "Nobody here has seen it" appearing or not tells a
--    stranger whether *someone* in the group watched each pick; in a two-person
--    public group that someone is the victim.
--
--    Hiding counts fixes none of that. What does is consent: in a public group
--    a member's data enters a night only if they joined that night themselves
--    (SPEC §4.5's remote lobby, where joining is always an explicit "I'm in"
--    tap -- 20260809140000_remote_night_lobby.sql). The rule, enforced in the
--    two SECURITY DEFINER functions that read other members' rows:
--
--      every present member other than the caller must be an attendee of the
--      group's open, unexpired lobby, and so must the caller.
--
--    The caller alone is always allowed: picking for yourself reads only your
--    own rows. Invite-only groups keep the checklist exactly as before; those
--    are people who were handed the invite code, the "4-6 friends" case the
--    checklist was designed for.
--
--    seen_count, for the same groups, counts present members only. That makes
--    it 0 for every candidate (a present member's watched film isn't a
--    candidate), so "Nobody here has seen it" always shows. That is true of
--    who is here, which is what the line says.
--
-- 2. Group lists past PostgREST's max_rows.
--
--    The night page read the group list through PostgREST to hand it back as
--    p_candidates alongside widened titles, and PostgREST silently caps a
--    read at max_rows (1000, supabase/config.toml). A public group's list can
--    pass that, and the picker would then score a truncated pool without
--    saying so. recommend_movies gains p_extra: titles scored *in addition
--    to* the group list, which it now always reads itself, in SQL, uncapped.
--    The page stops reading the list at all.

-- ------------------------------------------------ groups.opened_to_public_at

-- "Public" can't be read off `visibility` alone. An owner who flips a public
-- group back to invite-only keeps every stranger who joined meanwhile (there
-- is no way to remove a member), so the rule has to outlive the flip. This
-- stamps the first time a group became public and is never cleared.
--
-- Readable by members through the existing table-wide `grant select` on groups
-- (phase 3), which the night page uses to decide which UI to show. Not
-- writable by anyone directly: groups has no UPDATE grant, and the INSERT
-- grant can't be used to dodge it, because the trigger below overrides it.
alter table groups add column opened_to_public_at timestamptz;

create function public.stamp_group_opened_to_public()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- Once stamped, always stamped: the whole point is to survive a flip back.
    new.opened_to_public_at := coalesce(old.opened_to_public_at, new.opened_to_public_at);
  end if;
  if new.visibility = 'public' and new.opened_to_public_at is null then
    new.opened_to_public_at := now();
  end if;
  return new;
end;
$$;

create trigger groups_stamp_opened_to_public
  before insert or update of visibility, opened_to_public_at on groups
  for each row execute function public.stamp_group_opened_to_public();

-- Groups that are public today. A group that was public once and has already
-- been flipped back can't be recovered: nothing recorded it. Accepted: phase
-- 12 shipped on 2026-08-05 and production has three onboarded users.
update groups set opened_to_public_at = now()
where visibility = 'public' and opened_to_public_at is null;

-- ------------------------------------------- the consent check, in one place

-- Raises unless everyone in p_present consented to this night, per the rule in
-- the header. A plain function (not SECURITY DEFINER) called only from the two
-- definer functions below, so it runs with their privileges and can read
-- movie_night_attendees for the whole lobby. Not granted to anyone: callers
-- can't probe it directly.
--
-- The 12 hours is lib/lobby.ts's LOBBY_TTL_HOURS, now in a fourth place
-- (20260924130000_lobby_expiry.sql explains why the number is repeated rather
-- than shared). A lobby past it isn't one the picker should trust.
create function public._assert_night_consent(p_group_id uuid, p_present uuid[])
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  v_night uuid;
begin
  if not exists (
    select 1 from public.groups g
    where g.id = p_group_id and g.opened_to_public_at is not null
  ) then
    return;
  end if;

  -- One open lobby per group (movie_nights_one_open_lobby_idx), and it only
  -- counts if the caller is in it.
  select n.id into v_night
  from public.movie_nights n
  join public.movie_night_attendees a
    on a.movie_night_id = n.id and a.user_id = me
  where n.group_id = p_group_id
    and n.closed_at is null
    and n.held_at >= now() - interval '12 hours';

  if exists (
    select 1 from unnest(p_present) u
    where u is distinct from me
      and (
        v_night is null
        or not exists (
          select 1 from public.movie_night_attendees a
          where a.movie_night_id = v_night and a.user_id = u
        )
      )
  ) then
    raise exception 'in a public group, only people who joined tonight''s night count as present'
      using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public._assert_night_consent(uuid, uuid[])
  from public, anon, authenticated, service_role;

-- ----------------------------------------------------------- recommend_movies

-- New signature (p_extra), so drop and recreate rather than overload: two
-- recommend_movies with overlapping defaults would make PostgREST's named-
-- argument resolution ambiguous. Everything not called out below is
-- 20260805170000_explore_scroll_past.sql's body, unchanged.
drop function public.recommend_movies(uuid, uuid[], uuid[], uuid[]);

create function public.recommend_movies(
  p_group_id uuid,
  p_present uuid[],
  p_exclude uuid[] default '{}'::uuid[],
  p_candidates uuid[] default null::uuid[],
  -- Home mode's widen step (§4.2): titles to score on top of the group list.
  -- Ignored when p_candidates is set (theatre mode replaces the pool outright).
  p_extra uuid[] default null::uuid[]
)
returns table(
  movie_id uuid,
  title text,
  year integer,
  poster_path text,
  score double precision,
  present_count integer,
  hyped_count integer,
  seen_count integer,
  top_person text,
  top_person_count integer,
  match_tags text[]
)
language plpgsql
stable security definer
set search_path to ''
as $$
#variable_conflict use_column
declare
  v_public boolean;
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(p_present) u
    where not exists (
      select 1 from public.group_members m
      where m.group_id = p_group_id and m.user_id = u
    )
  ) then
    raise exception 'present members must belong to this group'
      using errcode = '42501';
  end if;

  -- New: see the header, part 1.
  perform public._assert_night_consent(p_group_id, p_present);

  select g.opened_to_public_at is not null into v_public
  from public.groups g where g.id = p_group_id;

  return query
  with present as (
    select distinct u as user_id from unnest(p_present) u
  ),

  -- The group list is read here whenever p_candidates is null, with or
  -- without p_extra -- never handed in from the page, which is what capped it
  -- at max_rows (header, part 2).
  pool as (
    select distinct li.movie_id
    from public.list_items li
    join public.lists l on l.id = li.list_id
    where p_candidates is null
      and l.owner_group_id = p_group_id
    union
    select distinct u
    from unnest(p_candidates) u
    where p_candidates is not null
    union
    select distinct u
    from unnest(p_extra) u
    where p_candidates is null and p_extra is not null
  ),

  candidates as (
    select p.movie_id
    from pool p
    where not (p.movie_id = any (coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1
        from public.user_movie_status s
        join present pr on pr.user_id = s.user_id
        where s.movie_id = p.movie_id and s.watched
      )
  ),

  weighted_members as (
    select
      p.user_id,
      exists (
        select 1 from public.user_tag_weights w where w.user_id = p.user_id
      ) as has_weights
    from present p
  ),

  raw_taste as (
    select
      p.user_id,
      c.movie_id,
      coalesce((
        select sum(w.weight * mt.weight)
        from public.movie_tags mt
        join public.user_tag_weights w
          on w.tag_id = mt.tag_id and w.user_id = p.user_id
        where mt.movie_id = c.movie_id
      ), 0)::double precision as raw_score
    from present p
    cross join candidates c
  ),

  taste as (
    select
      r.user_id,
      r.movie_id,
      case
        when max(r.raw_score) over m = min(r.raw_score) over m then 0.5
        else (r.raw_score - min(r.raw_score) over m)
             / (max(r.raw_score) over m - min(r.raw_score) over m)
      end as taste
    from raw_taste r
    window m as (partition by r.user_id)
  ),

  -- Hype / disinterest overrides taste:
  -- superhyped = 1.0, hyped = 0.7, dont_care (explicit "Meh" vote) = 0.25,
  -- scrolled past (didn't bother voting) = 0.1
  scored as (
    select
      t.user_id,
      t.movie_id,
      coalesce(
        case s.hype
          when 'superhyped' then 1.0
          when 'hyped'      then 0.7
          when 'dont_care'  then 0.25
        end,
        case
          when s.scrolled_past_at is not null then 0.1
        end,
        t.taste
      ) as score
    from taste t
    left join public.user_movie_status s
      on s.user_id = t.user_id
     and s.movie_id = t.movie_id
  ),

  agg as (
    select
      sc.movie_id,
      0.7 * coalesce(
              min(sc.score) filter (where wm.has_weights),
              min(sc.score)
            )
      + 0.3 * avg(sc.score) as score
    from scored sc
    join weighted_members wm on wm.user_id = sc.user_id
    group by sc.movie_id
  ),

  hyped_counts as (
    select c.movie_id, count(s.user_id)::int as hyped_count
    from candidates c
    left join public.user_movie_status s
      on s.movie_id = c.movie_id
     and s.hype in ('hyped', 'superhyped')
     and s.user_id in (select p.user_id from present p)
    group by c.movie_id
  ),

  -- Changed for groups that have been public: present members only (header,
  -- part 1). Invite-only groups still count the whole membership, so an
  -- absent friend's watch still breaks the tie.
  seen_counts as (
    select c.movie_id, count(s.user_id)::int as seen_count
    from candidates c
    left join public.user_movie_status s
      on s.movie_id = c.movie_id
     and s.watched
     and s.user_id in (
       select p.user_id from present p where v_public
       union all
       select m.user_id from public.group_members m
       where m.group_id = p_group_id and not v_public
     )
    group by c.movie_id
  ),

  person_hits as (
    select
      c.movie_id,
      t.tag_value,
      count(*)::int as members,
      sum(w.weight)  as total
    from candidates c
    join public.movie_tags mt on mt.movie_id = c.movie_id
    join public.tags t on t.id = mt.tag_id and t.tag_type = 'person'
    join public.user_tag_weights w on w.tag_id = mt.tag_id
    join present p on p.user_id = w.user_id
    where w.weight > 0
    group by c.movie_id, t.tag_value
  ),

  best_person as (
    select distinct on (ph.movie_id) ph.movie_id, ph.tag_value, ph.members
    from person_hits ph
    order by ph.movie_id, ph.members desc, ph.total desc, ph.tag_value
  ),

  tag_hits as (
    select
      c.movie_id,
      t.tag_value,
      sum(w.weight) as total
    from candidates c
    join public.movie_tags mt on mt.movie_id = c.movie_id
    join public.tags t on t.id = mt.tag_id and t.tag_type in ('genre', 'keyword')
    join public.user_tag_weights w on w.tag_id = mt.tag_id
    join present p on p.user_id = w.user_id
    group by c.movie_id, t.tag_value
    having sum(w.weight) > 0
  ),

  matched_tags as (
    select
      ranked.movie_id,
      array_agg(ranked.tag_value order by ranked.total desc, ranked.tag_value)
        as tags
    from (
      select
        th.movie_id,
        th.tag_value,
        th.total,
        row_number() over (
          partition by th.movie_id order by th.total desc, th.tag_value
        ) as rn
      from tag_hits th
    ) ranked
    where ranked.rn <= 3
    group by ranked.movie_id
  )

  select
    a.movie_id,
    m.title,
    m.year,
    m.poster_path,
    a.score,
    (select count(*)::int from present),
    coalesce(hc.hyped_count, 0),
    coalesce(sc.seen_count, 0),
    bp.tag_value,
    bp.members,
    coalesce(mtg.tags, '{}'::text[])
  from agg a
  join public.movies m on m.id = a.movie_id
  left join hyped_counts hc on hc.movie_id = a.movie_id
  left join seen_counts  sc on sc.movie_id = a.movie_id
  left join best_person  bp on bp.movie_id = a.movie_id
  left join matched_tags mtg on mtg.movie_id = a.movie_id
  order by
    a.score desc,
    coalesce(sc.seen_count, 0) asc,
    m.rating_external desc nulls last,
    m.runtime asc nulls last
  limit 3;
end;
$$;

-- Grants do not survive a DROP; reissued exactly as phase 9 had them.
revoke execute on function public.recommend_movies(uuid, uuid[], uuid[], uuid[], uuid[])
  from public, anon, service_role;
grant execute on function public.recommend_movies(uuid, uuid[], uuid[], uuid[], uuid[])
  to authenticated;

-- ---------------------------------------------------------------- widen_seeds

-- Same consent check: widen_seeds returns the present members' top-rated list
-- films to the caller and counts their unwatched candidates, so it leaks the
-- same way. Body otherwise unchanged from
-- 20260809120000_widen_candidate_pool.sql; same signature, so `create or
-- replace` keeps its grants.
create or replace function public.widen_seeds(
  p_group_id uuid,
  p_present  uuid[],
  p_exclude  uuid[] default '{}'::uuid[]
)
returns table (
  candidate_count    int,
  seed_external_ids  text[]
)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  if exists (
    select 1 from unnest(p_present) u
    where not exists (
      select 1 from public.group_members m
      where m.group_id = p_group_id and m.user_id = u
    )
  ) then
    raise exception 'present members must belong to this group'
      using errcode = '42501';
  end if;

  perform public._assert_night_consent(p_group_id, p_present);

  return query
  with present as (
    select distinct u as user_id from unnest(p_present) u
  ),

  candidates as (
    select distinct li.movie_id
    from public.list_items li
    join public.lists l on l.id = li.list_id
    where l.owner_group_id = p_group_id
      and not (li.movie_id = any (coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1
        from public.user_movie_status s
        join present pr on pr.user_id = s.user_id
        where s.movie_id = li.movie_id and s.watched
      )
  ),

  rated_list_films as (
    select
      li.movie_id,
      sum(
        case s.rating
          when 'love' then  3
          when 'like' then  1
          when 'hate' then -2
        end
      ) as rating_score
    from public.list_items li
    join public.lists l on l.id = li.list_id
    join public.user_movie_status s on s.movie_id = li.movie_id
    join present p on p.user_id = s.user_id
    where l.owner_group_id = p_group_id
      and s.rating is not null
    group by li.movie_id
    having sum(
      case s.rating
        when 'love' then  3
        when 'like' then  1
        when 'hate' then -2
      end
    ) > 0
  ),

  top_seeds as (
    select rlf.movie_id, rlf.rating_score, m.rating_external
    from rated_list_films rlf
    join public.movies m on m.id = rlf.movie_id
    order by rlf.rating_score desc, m.rating_external desc nulls last
    limit 3
  )

  select
    (select count(*)::int from candidates),
    coalesce(
      (
        select array_agg(ei.external_id order by ts.rating_score desc, ts.rating_external desc nulls last)
        from top_seeds ts
        join public.movie_external_ids ei
          on ei.movie_id = ts.movie_id and ei.provider = 'tmdb'
      ),
      '{}'::text[]
    );
end;
$$;
