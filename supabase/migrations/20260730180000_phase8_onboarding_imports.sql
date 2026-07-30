-- Phase 8: mandatory onboarding and resumable IMDb/Letterboxd imports.
--
-- Imports are processed one durable row at a time while Venn is open. Raw
-- export files stay in the browser; only normalized rows reach Postgres.

-- ------------------------------------------------------------- onboarding

alter table public.profiles
  add column onboarded_at timestamptz,
  add constraint profiles_region_format check (region ~ '^[A-Z]{2}$');

-- Phase 0 granted UPDATE at table scope. Keep all existing profile edits
-- available, but make onboarded_at writable only through complete_onboarding(),
-- which verifies the ten-rating requirement inside Postgres.
revoke update on public.profiles from authenticated;
grant update (username, display_name, avatar_url, region, default_list_visibility)
  on public.profiles to authenticated;

create function public.complete_onboarding()
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
  ) < 10 then
    raise exception 'ten ratings required' using errcode = '22023';
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

-- ---------------------------------------------------------------- imports

create type public.library_import_source as enum ('imdb', 'letterboxd');
create type public.library_import_status as enum (
  'uploading',
  'processing',
  'needs_review',
  'completed',
  'failed'
);
create type public.library_import_row_status as enum (
  'pending',
  'matched',
  'unmatched',
  'dismissed'
);

create table public.imports (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  source          public.library_import_source not null,
  status          public.library_import_status not null default 'uploading',
  total           int not null,
  processed       int not null default 0,
  matched         int not null default 0,
  unmatched_rows  jsonb not null default '[]'::jsonb,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  completed_at    timestamptz,
  constraint imports_counts_valid check (
    total >= 0
    and processed >= 0 and processed <= total
    and matched >= 0 and matched <= processed
  ),
  constraint imports_unmatched_is_array check (
    jsonb_typeof(unmatched_rows) = 'array'
  )
);

create index imports_user_created_idx
  on public.imports (user_id, created_at desc);

create unique index imports_one_processing_per_user_idx
  on public.imports (user_id)
  where status in ('uploading', 'processing');

create table public.import_rows (
  id                   uuid primary key default gen_random_uuid(),
  import_id            uuid not null references public.imports (id) on delete cascade,
  row_number           int not null,
  imdb_id              text,
  title                text not null,
  year                 int,
  expected_media_type  public.media_type,
  watched              boolean not null,
  rating               public.movie_rating,
  status               public.library_import_row_status not null default 'pending',
  attempts             smallint not null default 0,
  candidate_movie_ids  uuid[] not null default '{}',
  resolved_movie_id    uuid references public.movies (id) on delete set null,
  error                text,
  created_at           timestamptz not null default now(),
  unique (import_id, row_number),
  constraint import_rows_rating_requires_watched check (
    watched or rating is null
  ),
  constraint import_rows_attempts_valid check (attempts >= 0)
);

create index import_rows_work_idx
  on public.import_rows (import_id, status, row_number);

-- Every new table gets the same explicit grant reset. Hosted and local
-- Supabase default in opposite directions without it.
revoke all on public.imports, public.import_rows
  from anon, authenticated, service_role;

grant select, insert on public.imports to authenticated;
grant update (
  status, total, processed, matched, unmatched_rows, error,
  updated_at, completed_at
) on public.imports to authenticated;

grant select, insert on public.import_rows to authenticated;
grant update (
  status, attempts, candidate_movie_ids, resolved_movie_id, error
) on public.import_rows to authenticated;

alter table public.imports enable row level security;
alter table public.import_rows enable row level security;

create policy imports_select_own on public.imports
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy imports_insert_own on public.imports
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy imports_update_own on public.imports
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy import_rows_select_own on public.import_rows
  for select to authenticated
  using (exists (
    select 1
    from public.imports i
    where i.id = import_rows.import_id
      and i.user_id = (select auth.uid())
  ));

create policy import_rows_insert_own on public.import_rows
  for insert to authenticated
  with check (exists (
    select 1
    from public.imports i
    where i.id = import_rows.import_id
      and i.user_id = (select auth.uid())
  ));

create policy import_rows_update_own on public.import_rows
  for update to authenticated
  using (exists (
    select 1
    from public.imports i
    where i.id = import_rows.import_id
      and i.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1
    from public.imports i
    where i.id = import_rows.import_id
      and i.user_id = (select auth.uid())
  ));

-- Apply a provider-resolved catalog id to the user's personal library. This is
-- one transaction so the list, status, and job row cannot disagree.
create function public.apply_import_match(p_row_id uuid, p_movie_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_import_id uuid;
  v_import_status public.library_import_status;
  v_row_status public.library_import_row_status;
  v_watched boolean;
  v_rating public.movie_rating;
  v_list_id uuid;
  v_unmatched jsonb;
  v_unmatched_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select r.import_id, i.status, r.status, r.watched, r.rating
  into v_import_id, v_import_status, v_row_status, v_watched, v_rating
  from public.import_rows r
  join public.imports i on i.id = r.import_id
  where r.id = p_row_id and i.user_id = v_uid
  for update of r;

  if not found then
    raise exception 'import row not found' using errcode = '42501';
  end if;

  if v_row_status = 'matched' then
    return;
  end if;

  if v_row_status = 'dismissed' then
    raise exception 'import row dismissed' using errcode = '22023';
  end if;

  select l.id into v_list_id
  from public.lists l
  where l.owner_user_id = v_uid and l.is_default
  limit 1;

  if v_list_id is null then
    raise exception 'default list not found' using errcode = '23503';
  end if;

  insert into public.list_items (list_id, movie_id, added_by)
  values (v_list_id, p_movie_id, v_uid)
  on conflict (list_id, movie_id) do nothing;

  if v_watched then
    insert into public.user_movie_status (
      user_id, movie_id, watched, rating, hype, watched_at, updated_at
    )
    values (v_uid, p_movie_id, true, v_rating, null, null, now())
    on conflict (user_id, movie_id) do update
      set watched = true,
          rating = excluded.rating,
          hype = null,
          watched_at = null,
          updated_at = excluded.updated_at;
  else
    insert into public.user_movie_status (
      user_id, movie_id, watched, rating, hype, watched_at, updated_at
    )
    values (v_uid, p_movie_id, false, null, null, null, now())
    on conflict (user_id, movie_id) do update
      set watched = false,
          rating = null,
          hype = null,
          watched_at = null,
          updated_at = excluded.updated_at
      where not public.user_movie_status.watched;
  end if;

  update public.import_rows
  set status = 'matched',
      resolved_movie_id = p_movie_id,
      candidate_movie_ids = '{}',
      error = null
  where id = p_row_id;

  update public.imports i
  set processed = (
        select count(*)::int
        from public.import_rows r
        where r.import_id = v_import_id and r.status <> 'pending'
      ),
      matched = (
        select count(*)::int
        from public.import_rows r
        where r.import_id = v_import_id and r.status = 'matched'
      ),
      updated_at = now()
  where i.id = v_import_id;

  -- User-driven review happens after the automatic batch has already rebuilt
  -- once. Keep taste current after each explicit correction, matching normal
  -- manual rating behavior.
  if v_import_status = 'needs_review' then
    perform public._rebuild_tag_weights(v_uid);

    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'rowNumber', r.row_number,
            'imdbId', r.imdb_id,
            'title', r.title,
            'year', r.year,
            'error', r.error
          )
          order by r.row_number
        ) filter (where r.status = 'unmatched'),
        '[]'::jsonb
      ),
      count(*) filter (where r.status = 'unmatched')::int
    into v_unmatched, v_unmatched_count
    from public.import_rows r
    where r.import_id = v_import_id;

    update public.imports
    set status = case when v_unmatched_count = 0 then 'completed' else 'needs_review' end,
        unmatched_rows = v_unmatched,
        completed_at = case when v_unmatched_count = 0 then now() else completed_at end,
        updated_at = now()
    where id = v_import_id;
  end if;
end;
$$;

revoke execute on function public.apply_import_match(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_import_match(uuid, uuid) to authenticated;

-- Called after the processor observes no pending rows. The status row lock and
-- processing-only transition ensure exactly one caller performs the batch
-- rebuild even if two browser tabs finish together.
create function public.finish_import(p_import_id uuid)
returns public.library_import_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_status public.library_import_status;
  v_unmatched jsonb;
  v_unmatched_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select i.status into v_status
  from public.imports i
  where i.id = p_import_id and i.user_id = v_uid
  for update;

  if not found then
    raise exception 'import not found' using errcode = '42501';
  end if;

  if v_status <> 'processing' then
    return v_status;
  end if;

  if exists (
    select 1 from public.import_rows r
    where r.import_id = p_import_id and r.status = 'pending'
  ) then
    return v_status;
  end if;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'rowNumber', r.row_number,
          'imdbId', r.imdb_id,
          'title', r.title,
          'year', r.year,
          'error', r.error
        )
        order by r.row_number
      ) filter (where r.status = 'unmatched'),
      '[]'::jsonb
    ),
    count(*) filter (where r.status = 'unmatched')::int
  into v_unmatched, v_unmatched_count
  from public.import_rows r
  where r.import_id = p_import_id;

  perform public._rebuild_tag_weights(v_uid);

  v_status := case
    when v_unmatched_count = 0 then 'completed'
    else 'needs_review'
  end;

  update public.imports i
  set status = v_status,
      processed = i.total,
      matched = (
        select count(*)::int
        from public.import_rows r
        where r.import_id = p_import_id and r.status = 'matched'
      ),
      unmatched_rows = v_unmatched,
      completed_at = now(),
      updated_at = now()
  where i.id = p_import_id;

  return v_status;
end;
$$;

revoke execute on function public.finish_import(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_import(uuid) to authenticated;

create function public.dismiss_import_row(p_row_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_import_id uuid;
  v_unmatched jsonb;
  v_unmatched_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select r.import_id into v_import_id
  from public.import_rows r
  join public.imports i on i.id = r.import_id
  where r.id = p_row_id
    and i.user_id = v_uid
    and i.status = 'needs_review'
    and r.status = 'unmatched'
  for update of r;

  if not found then
    raise exception 'import row not found' using errcode = '42501';
  end if;

  update public.import_rows
  set status = 'dismissed'
  where id = p_row_id;

  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'rowNumber', r.row_number,
          'imdbId', r.imdb_id,
          'title', r.title,
          'year', r.year,
          'error', r.error
        )
        order by r.row_number
      ) filter (where r.status = 'unmatched'),
      '[]'::jsonb
    ),
    count(*) filter (where r.status = 'unmatched')::int
  into v_unmatched, v_unmatched_count
  from public.import_rows r
  where r.import_id = v_import_id;

  update public.imports
  set status = case when v_unmatched_count = 0 then 'completed' else 'needs_review' end,
      processed = (
        select count(*)::int
        from public.import_rows r
        where r.import_id = v_import_id and r.status <> 'pending'
      ),
      matched = (
        select count(*)::int
        from public.import_rows r
        where r.import_id = v_import_id and r.status = 'matched'
      ),
      unmatched_rows = v_unmatched,
      completed_at = case when v_unmatched_count = 0 then now() else completed_at end,
      updated_at = now()
  where id = v_import_id;
end;
$$;

revoke execute on function public.dismiss_import_row(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.dismiss_import_row(uuid) to authenticated;
