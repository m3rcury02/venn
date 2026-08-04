-- Explore scroll-past disinterest signal.
--
-- Differentiates an explicit "Meh" vote (hype = 'dont_care', score 0.25) from an
-- implicit scroll-past where the user didn't bother voting (scrolled_past_at,
-- score 0.1).
--
-- `user_movie_status` already carries `grant select, insert, update, delete on
-- user_movie_status to authenticated, service_role` table-wide
-- (20260726002633_phase0_core.sql:181), so this column is readable and writable
-- with no grant change.

alter table user_movie_status add column scrolled_past_at timestamptz;

-- Update recommend_movies to give scrolled-past movies a lower score (0.1) than explicit "Meh" (0.25)
create or replace function public.recommend_movies(
  p_group_id uuid,
  p_present uuid[],
  p_exclude uuid[] default '{}'::uuid[],
  p_candidates uuid[] default null::uuid[]
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

  return query
  with present as (
    select distinct u as user_id from unnest(p_present) u
  ),

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
