-- SPEC §4.2's widen step, built out of band against phase 4 -- see
-- docs/DECISIONS.md for why. Phase 4's own migration named this gap
-- explicitly (20260726154439_phase4_recommender.sql:25-27): "it needs a new
-- MovieDataProvider method and a cacheMovie per pulled title. The picker
-- returns fewer than 3 instead." lib/providers/tmdb.ts now has that method
-- (`recommendations`); this migration is the other half.
--
-- No table is created here, so CLAUDE.md's REVOKE-then-GRANT rule and the
-- "every new table gets RLS in the same migration" rule do not apply -- same
-- reasoning 20260802120000_explore_trailers.sql gave for the same shape.
--
-- Home mode only. Theatre mode's widen stays out of scope, unchanged from
-- 20260730190000_phase9_theatre.sql's own note on the subject.
--
-- recommend_movies itself is NOT touched. Its p_candidates parameter, added
-- in phase 9 as the theatre-mode override, is reused as-is: the caller reads
-- the group's list pool, appends widened candidate ids to it in TypeScript,
-- and passes the union through p_candidates. Widened picks are therefore
-- scored by the exact same function, with the exact same weights, as list
-- picks -- the only difference is provenance, surfaced to the user by
-- lib/recommend/explain.ts's new "Not on your lists yet" line.
--
-- Why this needs a SECURITY DEFINER function at all: the trigger condition is
-- "fewer than ~10 candidates", where a candidate is a group-list movie minus
-- anything a *present* member has watched. user_movie_status is strictly
-- closed under RLS (phase 3, reaffirmed by phase 12's hype_history entry) --
-- a member cannot read another present member's watched rows to compute that
-- count themselves. So the count, and the seed selection that depends on the
-- same present-members' ratings, both have to run server-side with elevated
-- privilege, exactly like recommend_movies already does.

create function public.widen_seeds(
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
  -- Both guards copied verbatim from recommend_movies
  -- (20260805170000_explore_scroll_past.sql:40-53) -- a SECURITY DEFINER
  -- function that reads other members' watched rows and ratings must not be
  -- callable for a group the caller does not belong to, nor with a p_present
  -- that smuggles in a non-member's id.
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

  return query
  with present as (
    select distinct u as user_id from unnest(p_present) u
  ),

  -- Mirrors recommend_movies' home-mode `candidates` CTE exactly
  -- (20260805170000_explore_scroll_past.sql:60-82, p_candidates-is-null
  -- branch): the group's list pool, minus p_exclude, minus anything watched
  -- by a present member. This *is* the count the page's empty-state check
  -- already makes implicitly by getting zero picks back -- computed here
  -- instead so the page can decide whether to widen before calling
  -- recommend_movies at all.
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

  -- §4.2: "seeded by the group's top-rated films" -- the plain reading is
  -- films on the group's own list, ranked by present members' ratings on
  -- them. §4.1's rating weights are repeated here rather than shared with
  -- _rebuild_tag_weights, because that function scores (rating, tag) pairs
  -- and this scores (rating) alone; there is no shared shape to factor out.
  -- Deliberately NOT seeding from present members' ratings on films outside
  -- the group list -- recorded as deferred in docs/DECISIONS.md.
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

revoke execute on function public.widen_seeds(uuid, uuid[], uuid[])
  from public, anon, service_role;
grant execute on function public.widen_seeds(uuid, uuid[], uuid[])
  to authenticated;
