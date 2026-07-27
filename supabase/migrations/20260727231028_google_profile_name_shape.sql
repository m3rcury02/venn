-- Production Google identities expose full_name/name, not given_name. Use the
-- first whitespace-delimited part as the requested first-name display while
-- preserving any display name the user has already chosen.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    case
      when (
        new.raw_app_meta_data ->> 'provider' = 'google'
        or coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
      )
      then substring(
        coalesce(
          nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
          nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
        )
        from '^[^[:space:]]+'
      )
      else null
    end
  );

  insert into public.lists (name, owner_user_id, is_default)
  values ('My List', new.id, true);

  return new;
end;
$$;

revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

update public.profiles as p
set display_name = substring(
  coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), '')
  )
  from '^[^[:space:]]+'
)
from auth.users as u
where u.id = p.id
  and nullif(btrim(p.display_name), '') is null
  and coalesce(
    nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(u.raw_user_meta_data ->> 'name'), '')
  ) is not null
  and (
    u.raw_app_meta_data ->> 'provider' = 'google'
    or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
  );
