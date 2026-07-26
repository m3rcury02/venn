-- Phase 0: identity, catalog cache, lists, and per-user status.
--
-- Scope is the core of SPEC.md §3 only: the tables whose ownership model is
-- single-user today, so their RLS can be written correctly now. Groups (§9
-- phase 3) and follows/blocks/visibility (phase 10) widen these policies later;
-- that widening is those phases' named deliverable, so it is not built here.

-- ---------------------------------------------------------------- enums

create type list_visibility as enum ('public', 'followers', 'private');
create type movie_rating    as enum ('hate', 'like', 'love');
create type movie_hype      as enum ('dont_care', 'hyped', 'superhyped');
create type tag_type        as enum ('genre', 'keyword', 'person');

-- ------------------------------------------------------------- identity

create table profiles (
  id                       uuid primary key references auth.users (id) on delete cascade,
  -- Nullable until onboarding (§7 screen 2) lands in phase 8.
  username                 text unique,
  display_name             text,
  avatar_url               text,
  region                   text not null default 'IN',
  default_list_visibility  list_visibility not null default 'private',
  created_at               timestamptz not null default now(),
  constraint username_format check (
    username is null or username ~ '^[a-z0-9_]{3,30}$'
  )
);

-- -------------------------------------------------------- catalog cache

-- movies.id is a surrogate uuid: provider ids live in movie_external_ids, so
-- swapping providers remaps one table instead of breaking every foreign key.
create table movies (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  original_title   text,
  year             int,
  poster_path      text,
  backdrop_path    text,
  runtime          int,
  overview         text,
  rating_external  numeric(3, 1),
  release_date     date,
  fetched_at       timestamptz not null default now()
);

create table movie_external_ids (
  movie_id     uuid not null references movies (id) on delete cascade,
  provider     text not null,
  external_id  text not null,
  primary key (provider, external_id),
  unique (movie_id, provider)
);

-- Tags are normalized to integers: a user with 500 imported films generates
-- thousands of tag rows, and storing tag strings on each would blow past the
-- free tier far sooner.
create table tags (
  id         serial primary key,
  tag_type   tag_type not null,
  tag_value  text not null,
  unique (tag_type, tag_value)
);

create table movie_tags (
  movie_id  uuid not null references movies (id) on delete cascade,
  tag_id    int not null references tags (id) on delete cascade,
  weight    real not null default 1,
  primary key (movie_id, tag_id)
);

create index movie_tags_tag_id_idx on movie_tags (tag_id);

-- ---------------------------------------------------------------- lists

-- owner_user_id is NOT NULL in phase 0. Phase 3 ("group lists") makes it
-- nullable, adds owner_group_id + its FK, and swaps in §3's
-- num_nonnulls(owner_user_id, owner_group_id) = 1 check.
create table lists (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  owner_user_id  uuid not null references profiles (id) on delete cascade,
  visibility     list_visibility not null default 'private',
  is_default     boolean not null default false,
  created_at     timestamptz not null default now()
);

create index lists_owner_user_id_idx on lists (owner_user_id);

-- Exactly one default list per user.
create unique index lists_one_default_per_owner_idx
  on lists (owner_user_id) where is_default;

create table list_items (
  list_id   uuid not null references lists (id) on delete cascade,
  movie_id  uuid not null references movies (id) on delete cascade,
  added_by  uuid not null references profiles (id) on delete cascade,
  note      text,
  added_at  timestamptz not null default now(),
  primary key (list_id, movie_id)
);

create index list_items_movie_id_idx on list_items (movie_id);

-- ------------------------------------------------------- status & taste

create table user_movie_status (
  user_id     uuid not null references profiles (id) on delete cascade,
  movie_id    uuid not null references movies (id) on delete cascade,
  watched     boolean not null default false,
  rating      movie_rating,
  hype        movie_hype,
  watched_at  timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (user_id, movie_id),
  -- Watched rows carry a rating (or none yet); unwatched rows carry hype.
  -- rating stays nullable while watched: the vote is prompted, not blocking (§8).
  constraint vote_matches_watched_state check (
    (watched and hype is null) or ((not watched) and rating is null)
  )
);

create index user_movie_status_movie_id_idx on user_movie_status (movie_id);

-- ------------------------------------------------- new-user provisioning

-- SECURITY DEFINER is required to insert into public tables from a trigger on
-- auth.users. Two hardenings the common published snippet omits:
--   * `set search_path = ''` (forces the schema-qualified names below), and
--   * the REVOKE, because Postgres grants EXECUTE to PUBLIC by default, which
--     would otherwise expose this as a callable endpoint to anon.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);

  insert into public.lists (name, owner_user_id, is_default)
  values ('My List', new.id, true);

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------------------------- table grants

-- Two independent gates: these grants decide whether a role can reach the table
-- at all, RLS decides which rows it then sees.
--
-- The REVOKE is not redundant, and the two environments disagree without it:
-- a hosted project carries ALTER DEFAULT PRIVILEGES granting all DML to anon,
-- authenticated and service_role, so new tables arrive fully readable/writable,
-- while a fresh local stack grants no DML at all (leaving every policy below
-- unreachable -- "permission denied for table ..."). Revoking first and then
-- granting explicitly makes the end state identical either way, and is what
-- lets the anon assertions in tests/rls.test.sql hold against both.
--
-- anon is granted nothing: signed-out users have no business here in phase 0.

revoke all on
  profiles, movies, movie_external_ids, tags, movie_tags,
  lists, list_items, user_movie_status
  from anon, authenticated, service_role;

grant select, update on profiles to authenticated;

grant select on movies, movie_external_ids, tags, movie_tags to authenticated;

grant select, insert, update, delete
  on lists, list_items, user_movie_status to authenticated;

-- The catalog is written server-side only (CLAUDE.md hard rule), by the
-- service_role key. Note service_role bypasses RLS but still needs the grant.
grant select, insert, update, delete
  on movies, movie_external_ids, tags, movie_tags to service_role;
grant usage, select on sequence tags_id_seq to service_role;

-- ------------------------------------------------------------------ RLS

alter table profiles           enable row level security;
alter table movies             enable row level security;
alter table movie_external_ids enable row level security;
alter table tags               enable row level security;
alter table movie_tags         enable row level security;
alter table lists              enable row level security;
alter table list_items         enable row level security;
alter table user_movie_status  enable row level security;

-- profiles: own row only. Public profiles are phase 10.
-- No INSERT policy: rows come from handle_new_user(). No DELETE: cascades from auth.users.
create policy profiles_select_own on profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy profiles_update_own on profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Catalog cache: readable by any signed-in user, writable only by service_role
-- (which bypasses RLS). Having no write policies is the enforcement: it keeps
-- the provider write-through server-side, per the hard rule in CLAUDE.md.
create policy movies_select_all on movies
  for select to authenticated using (true);

create policy movie_external_ids_select_all on movie_external_ids
  for select to authenticated using (true);

create policy tags_select_all on tags
  for select to authenticated using (true);

create policy movie_tags_select_all on movie_tags
  for select to authenticated using (true);

-- lists: owner only.
create policy lists_select_own on lists
  for select to authenticated
  using ((select auth.uid()) = owner_user_id);

create policy lists_insert_own on lists
  for insert to authenticated
  with check ((select auth.uid()) = owner_user_id);

create policy lists_update_own on lists
  for update to authenticated
  using ((select auth.uid()) = owner_user_id)
  with check ((select auth.uid()) = owner_user_id);

create policy lists_delete_own on lists
  for delete to authenticated
  using ((select auth.uid()) = owner_user_id);

-- list_items: gated by the parent list's owner.
create policy list_items_select_via_list on list_items
  for select to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id and l.owner_user_id = (select auth.uid())
  ));

create policy list_items_insert_via_list on list_items
  for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and exists (
      select 1 from lists l
      where l.id = list_items.list_id and l.owner_user_id = (select auth.uid())
    )
  );

create policy list_items_update_via_list on list_items
  for update to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id and l.owner_user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from lists l
    where l.id = list_items.list_id and l.owner_user_id = (select auth.uid())
  ));

create policy list_items_delete_via_list on list_items
  for delete to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id and l.owner_user_id = (select auth.uid())
  ));

-- user_movie_status: own rows only. WITH CHECK on UPDATE stops a row being
-- reassigned to another user.
create policy user_movie_status_select_own on user_movie_status
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy user_movie_status_insert_own on user_movie_status
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy user_movie_status_update_own on user_movie_status
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy user_movie_status_delete_own on user_movie_status
  for delete to authenticated
  using ((select auth.uid()) = user_id);
