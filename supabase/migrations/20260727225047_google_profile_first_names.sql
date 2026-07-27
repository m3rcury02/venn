-- Fill an unnamed profile from Google's explicit given_name. Group screens
-- already read profiles.display_name; keeping the provider metadata behind
-- this column avoids exposing auth.users and preserves manual display names.

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
      then nullif(btrim(new.raw_user_meta_data ->> 'given_name'), '')
      else null
    end
  );

  insert into public.lists (name, owner_user_id, is_default)
  values ('My List', new.id, true);

  return new;
end;
$$;

-- CREATE OR REPLACE retains the existing ACL, but restate the intended final
-- privileges so this migration is safe even if that ACL has drifted.
revoke execute on function public.handle_new_user()
  from public, anon, authenticated;

-- Existing Google users predate the metadata-aware trigger. Fill only profiles
-- with no meaningful name; a name saved through the UI remains authoritative.
update public.profiles as p
set display_name = nullif(btrim(u.raw_user_meta_data ->> 'given_name'), '')
from auth.users as u
where u.id = p.id
  and nullif(btrim(p.display_name), '') is null
  and nullif(btrim(u.raw_user_meta_data ->> 'given_name'), '') is not null
  and (
    u.raw_app_meta_data ->> 'provider' = 'google'
    or coalesce(u.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google'
  );
