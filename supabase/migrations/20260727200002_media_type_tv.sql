-- TV shows join the catalog, treated exactly like movies with one exception:
-- group-owned lists stay movies-only, because the recommender (SPEC §4) draws its
-- candidate pool from group lists and is movie-shaped throughout (runtime
-- tie-break, nowPlaying/upcoming candidate sourcing for theatre mode).
--
-- No table is created here, so CLAUDE.md's REVOKE-then-GRANT rule does not apply.
-- `movies` already carries `grant select ... to authenticated` table-wide (not
-- column-scoped, phase0_core.sql), so the new column below is covered by the
-- existing grant with no change needed.

-- ---------------------------------------------------------------- catalog

create type media_type as enum ('movie', 'tv');

alter table movies add column media_type media_type not null default 'movie';

-- movie_external_ids is `primary key (provider, external_id)` with one
-- provider name ("tmdb"). TMDB's movie and TV id spaces are independent and both
-- start at 1, so a bare numeric external_id is structurally ambiguous, not
-- occasionally so. Every existing row is a movie (TV support did not exist
-- before this migration), so backfilling with a "movie-" prefix is exact, not a
-- guess. New rows are written prefixed by the application from here on --
-- lib/movies/cache.ts never strips or adds the prefix, it is the provider's id
-- as the app already knows it. A hyphen, not a colon: verified against a real
-- Next dev server that a colon in a dynamic route segment arrives
-- percent-encoded and undecoded, so /movies/external/[externalId] never
-- matches it. A hyphen needs no encoding.
update movie_external_ids
set external_id = 'movie-' || external_id
where external_id !~ '^(movie|tv)-';

-- --------------------------------------------------------------- list_items

-- Same two policies phase 3 wrote (phase3_groups.sql), widened with one more
-- clause: a group-owned list only accepts a movie. Personal lists (owner_user_id
-- set) are unaffected. This is the enforcement mechanism, not a trigger -- it
-- matches the "narrowness of the write policy is the enforcement" pattern this
-- schema already uses for the catalog tables (phase 0) and group_members
-- (phase 3), and it fails the same 42501 the existing pgTAP suite already
-- asserts elsewhere.
drop policy list_items_insert_via_list on list_items;
drop policy list_items_update_via_list on list_items;

create policy list_items_insert_via_list on list_items
  for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and exists (
      select 1 from lists l
      where l.id = list_items.list_id
        and (l.owner_user_id = (select auth.uid())
             or (l.owner_group_id is not null and public.is_group_member(l.owner_group_id)))
    )
    and (
      exists (
        select 1 from lists l
        where l.id = list_items.list_id and l.owner_group_id is null
      )
      or exists (
        select 1 from movies m
        where m.id = list_items.movie_id and m.media_type = 'movie'
      )
    )
  );

create policy list_items_update_via_list on list_items
  for update to authenticated
  using (exists (
    select 1 from lists l
    where l.id = list_items.list_id
      and (l.owner_user_id = (select auth.uid())
           or (l.owner_group_id is not null and public.is_group_member(l.owner_group_id)))
  ))
  with check (
    exists (
      select 1 from lists l
      where l.id = list_items.list_id
        and (l.owner_user_id = (select auth.uid())
             or (l.owner_group_id is not null and public.is_group_member(l.owner_group_id)))
    )
    and (
      exists (
        select 1 from lists l
        where l.id = list_items.list_id and l.owner_group_id is null
      )
      or exists (
        select 1 from movies m
        where m.id = list_items.movie_id and m.media_type = 'movie'
      )
    )
  );
