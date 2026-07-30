-- Global aggregate percentages for catalog detail pages.
--
-- user_movie_status stays private under its existing RLS policies. This
-- SECURITY DEFINER function is the privacy boundary: authenticated callers get
-- two percentages and no user ids, individual votes, or exact sample counts.

create function public.get_movie_vote_percentages(p_movie_id uuid)
returns table (
  hyped_percent int,
  loved_percent int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  return query
  select
    round(
      100.0
      * count(*) filter (
        where s.hype in (
          'hyped'::public.movie_hype,
          'superhyped'::public.movie_hype
        )
      )
      / nullif(count(s.hype), 0)
    )::int,
    round(
      100.0
      * count(*) filter (where s.rating = 'love'::public.movie_rating)
      / nullif(count(s.rating), 0)
    )::int
  from public.user_movie_status s
  where s.movie_id = p_movie_id;
end;
$$;

-- Hosted and local Supabase projects have differed on default function grants
-- in this repo. Reset every relevant role explicitly, then grant only the
-- authenticated browser role.
revoke execute on function public.get_movie_vote_percentages(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_movie_vote_percentages(uuid)
  to authenticated;
