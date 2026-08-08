-- Lower the onboarding rating minimum from ten to five.
--
-- complete_onboarding() (phase 8) required ten non-null ratings before
-- stamping onboarded_at. Ten was too long a wall for a first-run screen; five
-- is now the minimum and users are free to keep rating past it. See
-- docs/DECISIONS.md for the reasoning.

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

revoke execute on function public.complete_onboarding()
  from public, anon, authenticated, service_role;
grant execute on function public.complete_onboarding() to authenticated;
