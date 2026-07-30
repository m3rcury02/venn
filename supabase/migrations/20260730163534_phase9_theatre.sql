-- Phase 9: theatre mode -- same picker, release-status filter.
--
-- SPEC §4.2 defines a second candidate pool: nowPlaying(region) union upcoming
-- within N weeks, for the region shared by present members. Phase 0 explicitly
-- deferred movie_releases to "the phase that first consumes it" -- this one.
-- lib/providers/tmdb.ts already implements nowPlaying/upcoming (built in phase
-- 1a "because §2 defines them"); nothing has called them until now.
--
-- Two things happen here:
--   * movie_releases -- a per-region cache of what lib/movies/theatre.ts writes
--     after calling nowPlaying/upcoming, so the picker does not hit TMDB on
--     every render.
--   * recommend_movies gains an optional p_candidates array. NULL keeps
--     exactly today's home-mode behaviour (candidates from group-owned lists);
--     a non-null array is the theatre-mode override. This is a DROP and
--     RECREATE, not a second overload -- PostgREST resolves rpc() calls by the
--     set of named params supplied, so a 3-arg and 4-arg recommend_movies
--     coexisting would make the existing 3-arg call from
--     app/groups/[id]/night/page.tsx ambiguous.

-- ------------------------------------------------------------- movie_releases

-- Two values, not TMDB's finer 1-6 release-type taxonomy: that finer grain
-- lives on a per-title endpoint (/movie/{id}/release_dates) that §4.2 does not
-- ask for and that would cost a third TMDB call per candidate. These two map
-- directly to the two list endpoints that populate this table.
create type release_type as enum ('theatrical', 'upcoming');

create table movie_releases (
  movie_id      uuid not null references movies (id) on delete cascade,
  region        text not null,
  -- Nullable, unlike SPEC §3's bare column list. Phase 1a's own trap:
  -- lib/providers/tmdb.ts's toReleaseDate coerces TMDB's release_date: ""
  -- (sent for an unknown date, not null) to null. A NOT NULL column would
  -- throw on exactly that title and fail the whole refresh. Not part of the
  -- primary key, so nullable costs nothing.
  release_date  date,
  release_type  release_type not null,
  -- Not in SPEC §3's column list. This is the freshness signal
  -- lib/movies/theatre.ts reads to decide whether a region needs a TMDB
  -- refresh or can be served from cache -- the same role fetched_at plays on
  -- `movies` itself.
  fetched_at    timestamptz not null default now(),
  primary key (movie_id, region, release_type)
);

create index movie_releases_region_release_date_idx
  on movie_releases (region, release_date);

-- ---------------------------------------------------------------- grants

-- Same two-gate reasoning as every catalog table so far: REVOKE first because
-- hosted Supabase grants all DML on new tables by default while a fresh local
-- stack grants none, so without the revoke the two environments disagree in
-- opposite directions.
revoke all on movie_releases from anon, authenticated, service_role;

grant select on movie_releases to authenticated;
grant select, insert, update, delete on movie_releases to service_role;

-- ------------------------------------------------------------------- RLS

alter table movie_releases enable row level security;

-- Shared catalog data, same as movies_select_all: readable by anyone signed
-- in, no per-row ownership. No INSERT/UPDATE/DELETE policy at all -- absence
-- is the enforcement, the same argument phase 0 made for the catalog tables
-- and phase 4 for user_tag_weights. Only service_role (lib/movies/theatre.ts,
-- via createServiceClient) can write this table.
create policy movie_releases_select_all on movie_releases
  for select to authenticated using (true);

-- --------------------------------------------------------- recommend_movies

drop function public.recommend_movies(uuid, uuid[], uuid[]);

-- #variable_conflict use_column: every column in RETURNS TABLE is also a
-- plpgsql variable, and several share a name with a real column (movie_id,
-- title, score). Every reference below stays qualified anyway; this makes the
-- resolution rule explicit rather than relying on that discipline holding.
create function public.recommend_movies(
  p_group_id   uuid,
  p_present    uuid[],
  p_exclude    uuid[] default '{}',
  -- NULL is home mode (candidates from group-owned lists, byte-identical to
  -- phase 4). A non-null array is theatre mode: the caller (the night page,
  -- via lib/movies/theatre.ts) supplies the pool and this function only scores
  -- it. No membership guard on this array: the return shape is aggregates
  -- only, same privacy boundary as p_present, and a member could already put
  -- an arbitrary title in front of this function by adding it to the group
  -- list.
  p_candidates uuid[] default null
)
returns table (
  movie_id          uuid,
  title             text,
  year              int,
  poster_path       text,
  score             double precision,
  present_count     int,
  hyped_count       int,
  seen_count        int,
  top_person        text,
  top_person_count  int,
  match_tags        text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_group_member(p_group_id) then
    raise exception 'not a member of this group' using errcode = '42501';
  end if;

  -- Without this a caller could pass any uuid as "present" and read a
  -- stranger's taste back off the scores.
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

  return query
  with present as (
    select distinct u as user_id from unnest(p_present) u
  ),

  -- Split from the phase 4 `candidates` CTE into pool + candidates, so the
  -- home/theatre switch lives in one place and the exclusions below still run
  -- on whichever pool was selected, before `taste` normalizes.
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
  ),

  -- §4.2: minus the reroll exclusions, minus anything any present member has
  -- watched. Both HERE, before `taste` normalizes -- normalizing over the
  -- pre-exclusion set produces different numbers, and is an easy accident.
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

  -- §4.5 cold start: "a member with no tag weights is excluded from the min
  -- term." That is a per-MEMBER property, so it is resolved once, here -- not
  -- inside the per-candidate aggregate, where the predicate could drift between
  -- candidates and make their scores incomparable. Comparability is the only
  -- thing `taste` exists to guarantee.
  weighted_members as (
    select
      p.user_id,
      exists (
        select 1 from public.user_tag_weights w where w.user_id = p.user_id
      ) as has_weights
    from present p
  ),

  -- §4.3 step 1. The coalesce matters: a candidate sharing no tag with a member
  -- scores 0 for them and must still take part in the window below, or the
  -- min/max are computed over the wrong set.
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

  -- §4.3 step 2, and it is not optional: raw goes negative (hate is -2) while
  -- hype sits in [0.25, 1], so blending them unnormalized would systematically
  -- punish taste-scored candidates against hype-scored ones.
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

  -- §4.3 step 3: an explicit vote is stronger evidence than an inferred one.
  --
  -- coalesce(hype, taste) rather than a CASE over "did they vote", and the join
  -- itself requires hype is not null: phase 2 built setHype(null), so rows with
  -- watched = false and hype = null genuinely exist, and they must fall through
  -- to taste. A null score there would poison both min and avg below.
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
        t.taste
      ) as score
    from taste t
    left join public.user_movie_status s
      on s.user_id = t.user_id
     and s.movie_id = t.movie_id
     and s.hype is not null
  ),

  -- §4.3 step 4. The min term is load-bearing: averaging alone lets the loudest
  -- taste in the group dominate and produces picks one person quietly resents.
  -- The coalesce is §4.5's fallback for when *no* present member has weights.
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

  -- ------------------------------------------- §4.4 explanation components

  hyped_counts as (
    select c.movie_id, count(s.user_id)::int as hyped_count
    from candidates c
    left join public.user_movie_status s
      on s.movie_id = c.movie_id
     and s.hype in ('hyped', 'superhyped')
     and s.user_id in (select p.user_id from present p)
    group by c.movie_id
  ),

  -- Counted over the whole GROUP, not just present members: step 2 excludes
  -- anything a present member has watched, so a present-only count is always 0
  -- and both "Nobody here has seen it" and §4.3's first tie-break would be
  -- meaningless. One number drives both.
  seen_counts as (
    select c.movie_id, count(s.user_id)::int as seen_count
    from candidates c
    left join public.user_movie_status s
      on s.movie_id = c.movie_id
     and s.watched
     and s.user_id in (
       select m.user_id from public.group_members m where m.group_id = p_group_id
     )
    group by c.movie_id
  ),

  -- "3 of 4 love Christopher Nolan": the person tag positively weighted for the
  -- most present members. Ties break on summed weight, then name, so the result
  -- is deterministic.
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

  -- "Matches: sci-fi, heist, mind-bending" -- the group's three strongest
  -- positive genre/keyword overlaps with this candidate.
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
  -- §4.3's tie-break: fewer members have seen it, then higher external rating,
  -- then shorter runtime. Return top 3.
  order by
    a.score desc,
    coalesce(sc.seen_count, 0) asc,
    m.rating_external desc nulls last,
    m.runtime asc nulls last
  limit 3;
end;
$$;

-- Grants do not survive a DROP; reissued exactly as phase 4 had them.
revoke execute on function public.recommend_movies(uuid, uuid[], uuid[], uuid[])
  from public, anon, service_role;
grant execute on function public.recommend_movies(uuid, uuid[], uuid[], uuid[])
  to authenticated;
