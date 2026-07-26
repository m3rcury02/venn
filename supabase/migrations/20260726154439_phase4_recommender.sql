-- Phase 4: tag weights, the Top-3 recommender, explanations, reroll.
--
-- The first phase that *reads across users*. Phase 3 widened profiles, lists and
-- list_items to "my groups too" but deliberately left user_movie_status alone,
-- because SPEC §11 says a user must not read another's private ratings, and
-- recorded that "phase 4's recommender reads them server-side; that is phase 4's
-- problem". This migration is that answer.
--
-- recommend_movies is SECURITY DEFINER and reads every present member's
-- ratings, hype votes and tag weights -- but it returns only *per-candidate
-- aggregates*: counts, one tag name, a score. No per-member row ever leaves it.
-- So nothing here widens a policy, and user_movie_status stays exactly as
-- closed as phase 3 left it.
--
-- Deliberately NOT here, each per phase 0's own rule (defer a table to the phase
-- that first consumes it):
--   * hype_history -- phase 0's note said "-> 4", but §4 scores *current* hype
--     off user_movie_status and never reads history. Its first consumer is
--     phase 12's hype-vs-reality stats.
--   * movie_nights / movie_night_attendees / watch_confirmations -- §9's phase-4
--     row stops at "reroll". §7 screen 6's "pick -> logs night, prompts
--     confirmations" is §8's watch-confirmation flow, deferred to 11. Which
--     members are present is therefore transient UI state, not a table, and
--     user_tag_weights is this phase's only new write path.
--   * §4.2's widen step (provider recommendations when the pool is thin) -- it
--     needs a new MovieDataProvider method and a cacheMovie per pulled title.
--     The picker returns fewer than 3 instead.

-- ----------------------------------------------------------------- weights
--
-- SPEC §4.3: "All weights live in one config file." That is unsatisfiable here
-- and the conflict is inside the spec, not a shortcut: §1 and §10 require that
-- scoring be plain SQL over the normalized tag tables, and no TypeScript config
-- can reach inside a SQL function -- nor cover the rebuild half at all, which
-- runs on every vote. §1 wins, so tuning these means a migration.
--
-- This block is the index of where each group lives; the values are inline in
-- the two functions below and are deliberately NOT duplicated here, because a
-- comment that repeats a number is a comment that will disagree with it.
--
--   rating_weight    love/like/hate         §4.1  -> _rebuild_tag_weights
--   tag_type_weight  genre/person/keyword   §4.1  -> _rebuild_tag_weights
--   hype_score       superhyped/hyped/meh   §4.3  -> recommend_movies, `scored`
--   no-taste default 0.5 when max = min     §4.3  -> recommend_movies, `taste`
--   aggregate        0.7 x min + 0.3 x mean §4.3  -> recommend_movies, `agg`
--   tie-break        seen / rating / length §4.3  -> recommend_movies, order by
--
-- The §4.4 *explanation* thresholds are the part that does live in TypeScript
-- (lib/recommend/explain.ts), where tuning costs no migration.

-- ------------------------------------------------------------------- table

create table user_tag_weights (
  user_id  uuid not null references profiles (id) on delete cascade,
  tag_id   int not null references tags (id) on delete cascade,
  weight   real not null,
  primary key (user_id, tag_id)
);

-- No second index: the PK's leading column is user_id, and every read below
-- binds user_id and joins on tag_id, so the PK serves both. movie_tags is
-- reached through movie_tags_tag_id_idx, which phase 0 already created.

-- --------------------------------------------------------------- functions

-- The worker. Private (revoked from everyone -- phase 0's handle_new_user
-- precedent) so that the two callers below share one copy of §4.1's formula
-- instead of duplicating it: the public wrapper, and this migration's backfill.
--
-- Two things here are silent double-counting bugs if a later reader "fixes"
-- them, so both are called out where they happen:
--
--   * tag_type_weight is applied HERE AND ONLY HERE. lib/movies/cache.ts
--     carries a phase-1a comment saying the per-type weight applies "at scoring
--     time"; §4.1 is explicit that it applies when the weights are built, and
--     the spec wins. Applying it in both places makes a genre count 9x.
--   * movie_tags.weight is NOT a factor here. §4.1's formula omits it and
--     §4.3's includes it -- it belongs to scoring only.
create function public._rebuild_tag_weights(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_tag_weights where user_id = p_uid;

  -- Divided by the user's rated-movie count (§4.1), so someone with 500
  -- imported films does not drown out someone with 12. The cast to numeric is
  -- load-bearing: sum() over integers is bigint, and bigint / bigint is
  -- integer division, which would silently truncate every weight.
  insert into public.user_tag_weights (user_id, tag_id, weight)
  select
    p_uid,
    mt.tag_id,
    (sum(
       case s.rating
         when 'love' then  3
         when 'like' then  1
         when 'hate' then -2
       end
       *
       case t.tag_type
         when 'genre'   then 3
         when 'person'  then 2
         when 'keyword' then 1
       end
     )::numeric
     / nullif((
         select count(*) from public.user_movie_status
         where user_id = p_uid and rating is not null
       ), 0)
    )::real
  from public.user_movie_status s
  join public.movie_tags mt on mt.movie_id = s.movie_id
  join public.tags t on t.id = mt.tag_id
  where s.user_id = p_uid
    and s.rating is not null
  group by mt.tag_id;
end;
$$;

-- service_role is named explicitly, and it is not redundant with `public`:
-- hosted Supabase carries ALTER DEFAULT PRIVILEGES granting EXECUTE on new
-- functions to service_role, and that is a *direct* grant, so revoking from
-- PUBLIC does not remove it. A fresh local stack has no such default. This is
-- the function-level twin of the table-level asymmetry phase 0 documented, and
-- naming service_role here is what keeps the two environments identical.
revoke execute on function public._rebuild_tag_weights(uuid)
  from public, anon, authenticated, service_role;

-- §4.1: "rebuilt when a user's rating changes." Called from setRating and
-- setWatched (app/status/actions.ts) -- not setHype, which is not a tag-weight
-- input.
--
-- No arguments, reading auth.uid() internally, for the same reason phase 3's
-- is_group_member takes only a group id: the signature is what makes RPC
-- exposure harmless. The only user this can rebuild is the caller.
create function public.rebuild_user_tag_weights()
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

  perform public._rebuild_tag_weights(v_uid);
end;
$$;

revoke execute on function public.rebuild_user_tag_weights()
  from public, anon, service_role;
grant execute on function public.rebuild_user_tag_weights() to authenticated;

-- SPEC §4.2-§4.4, home mode. SECURITY DEFINER because it has to read other
-- members' user_movie_status and user_tag_weights, and the whole point is that
-- it does so without either table becoming readable. Its return shape is the
-- privacy boundary: aggregates only.
--
-- #variable_conflict use_column: every column in RETURNS TABLE is also a
-- plpgsql variable, and several share a name with a real column (movie_id,
-- title, score). Every reference below is qualified anyway; this makes the
-- resolution rule explicit rather than relying on that discipline holding.
create function public.recommend_movies(
  p_group_id uuid,
  p_present  uuid[],
  p_exclude  uuid[] default '{}'
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

  -- §4.2 home mode: movies on any list owned by the group, minus anything any
  -- present member has watched, minus the reroll exclusions (§4.5).
  --
  -- Both exclusions happen HERE, before `taste` normalizes. Normalizing over
  -- the pre-exclusion set produces different numbers, and is an easy accident.
  candidates as (
    select distinct li.movie_id
    from public.list_items li
    join public.lists l on l.id = li.list_id
    where l.owner_group_id = p_group_id
      and not (li.movie_id = any (coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1
        from public.user_movie_status s
        join present p on p.user_id = s.user_id
        where s.movie_id = li.movie_id and s.watched
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

revoke execute on function public.recommend_movies(uuid, uuid[], uuid[])
  from public, anon, service_role;
grant execute on function public.recommend_movies(uuid, uuid[], uuid[])
  to authenticated;

-- ---------------------------------------------------------------- grants

-- Same two-gate reasoning as phases 0 and 3, and the REVOKE is just as
-- non-redundant: hosted Supabase grants all DML on new tables by default while
-- a fresh local stack grants none.
--
-- SELECT only, for anyone. There is no INSERT/UPDATE/DELETE grant and no such
-- policy, which is the enforcement -- the same argument phase 0 made for the
-- catalog tables and phase 3 for group_members. Nothing but
-- _rebuild_tag_weights can write this table, so a row is always exactly the
-- derived function of that user's ratings. No service_role grant either: the
-- definer functions run as their owner and bypass grants.

revoke all on user_tag_weights from anon, authenticated, service_role;

grant select on user_tag_weights to authenticated;

-- ------------------------------------------------------------------- RLS

alter table user_tag_weights enable row level security;

-- Own rows only, exactly like user_movie_status. Weights are derived from
-- ratings, so they are the same private data in another shape (SPEC §11), and
-- the recommender reads across users through SECURITY DEFINER rather than
-- through this policy.
create policy user_tag_weights_select_own on user_tag_weights
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- --------------------------------------------------------------- backfill

-- Phase 2's votes are already in user_movie_status. Without this they stay
-- invisible to the recommender until each user happens to vote again, which
-- would make the picker look broken on day one. This is the second caller that
-- _rebuild_tag_weights exists to serve.
select public._rebuild_tag_weights(id) from profiles;
