-- TMDB's 6-month cache limit. TMDB's API Terms of Use, section 1.C, says you
-- may not "Cache, for longer than 6 months, any information obtained through or
-- from TMDB or the TMDB APIs." Phase 1a wrote `movies.fetched_at` and never read
-- it ("No TTL on `fetched_at`", docs/DECISIONS.md), so every cached title was
-- kept forever. The earliest rows date from phase 1a (July 2026), which puts
-- the first breach in January 2027.
--
-- Most of the fix is TypeScript: re-fetching a title needs TMDB, so it lives in
-- lib/movies/refresh.ts, run daily by app/api/cron/refresh-catalog. This
-- migration covers what TypeScript can't do cheaply over PostgREST: an index
-- so the oldest rows can be found, a timestamp on `tags`, and one function that
-- deletes TMDB-derived rows nothing will ever refresh.
--
-- No table is created here, so the REVOKE-then-GRANT rule and the "every new
-- table gets RLS in the same migration" rule do not apply. The new column on
-- `tags` needs no grant change either: phase 0 granted service_role select,
-- insert, update, delete on `tags` table-wide, not per column
-- (20260726002633_phase0_core.sql), and authenticated's select is table-wide.

-- ------------------------------------------------------------------ movies

-- lib/movies/refresh.ts reads `fetched_at < cutoff order by fetched_at limit N`
-- once a day. Without an index that is a sequential scan plus a sort of the
-- whole catalog.
create index movies_fetched_at_idx on movies (fetched_at);

-- -------------------------------------------------------------------- tags

-- A tag's value ("Christopher Nolan", "heist") is itself information obtained
-- from TMDB, so it is covered by the 6-month limit too. Nothing refreshes a tag
-- on its own: lib/movies/cache.ts re-upserts a tag every time it caches or
-- refreshes a title carrying it, and now stamps this column when it does. A tag
-- still in use is therefore never older than the oldest title using it. A tag
-- no title uses any more is never stamped again and gets deleted below.
--
-- The column also guards a race. cacheMovie upserts `tags` first and inserts
-- `movie_tags` second, so a brand-new tag has no movie_tags row for a moment.
-- An orphan-tag delete landing in that gap would make the movie_tags insert
-- fail its foreign key. prune_catalog only deletes orphans at least a day old.
alter table tags add column fetched_at timestamptz not null default now();

-- The default stamped every existing tag with this migration's time, which
-- makes tags look newer than they are. Backfill each one from the newest title
-- that carries it, which is when TMDB last sent that value. Orphans keep the
-- migration time. That is harmless: prune_catalog deletes them a day later.
update tags t
set fetched_at = sub.fetched_at
from (
  select mt.tag_id, max(m.fetched_at) as fetched_at
  from movie_tags mt
  join movies m on m.id = mt.movie_id
  group by mt.tag_id
) sub
where sub.tag_id = t.id;

-- ------------------------------------------------------------ prune_catalog

-- Deletes three kinds of TMDB-derived row that no refresh will ever touch:
--
--   * movie_releases older than p_stale_before. lib/movies/theatre.ts
--     re-fetches a region on its next render after 12 hours, but a region
--     nobody opens again keeps its rows forever. Deleting them loses only
--     theatre.ts's "serve the stale cache if TMDB is down" fallback, and at
--     p_stale_before's age that data is months out of date anyway.
--
--   * movies rows with no movie_external_ids mapping. cacheMovie's write order
--     (lib/movies/cache.ts, persistMovie) leaves one behind whenever it fails
--     after inserting the movie, or loses a concurrent race: "failing before
--     it leaves an orphaned movies row and the next call re-fetches cleanly."
--     Nothing can refresh an unmapped row, because the refresh needs the
--     external id to call TMDB. Harmless to keep until now, but it holds TMDB
--     content forever.
--
--   * tags no movie_tags row points at, per the column comment above.
--
-- An orphan movie id is never handed to a caller: persistMovie returns either
-- its own id after the mapping insert succeeds, or the race winner's id. So
-- nothing should reference one. The not-exists checks below are there anyway,
-- one per table whose foreign key to movies is `on delete cascade`: if that
-- reasoning is ever wrong, a user's list item, rating, hype history or
-- rejection must not disappear with the orphan. The `on delete set null`
-- references (ingest_inbox, import_rows, movie_nights, reports) only lose a
-- pointer, so they aren't checked.
--
-- Deleting an orphan tag cascades to user_tag_weights (phase 4's foreign key).
-- Those weights already score nothing: recommend_movies multiplies a weight by
-- a candidate's movie_tags row, and an orphan tag has none. _rebuild_tag_weights
-- would not recreate them either, because it builds weights from movie_tags.
--
-- SECURITY DEFINER because service_role has no grant on hype_history or
-- night_rejections, both of which the not-exists checks read (it already has
-- select on list_items and user_movie_status, from 20260802130000_explore_grants.sql).
-- Granting it select on two more user-data tables just for this would widen
-- the service key further than one function does. It also runs the three
-- deletes in one transaction, rather than as separate PostgREST requests.
create function public.prune_catalog(p_stale_before timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_releases int;
  v_movies   int;
  v_tags     int;
begin
  delete from public.movie_releases
  where fetched_at < p_stale_before;
  get diagnostics v_releases = row_count;

  -- The day's grace covers persistMovie in flight: its movies row exists
  -- before its mapping does.
  delete from public.movies m
  where m.fetched_at < now() - interval '1 day'
    and not exists (select 1 from public.movie_external_ids e where e.movie_id = m.id)
    and not exists (select 1 from public.list_items li where li.movie_id = m.id)
    and not exists (select 1 from public.user_movie_status s where s.movie_id = m.id)
    and not exists (select 1 from public.hype_history h where h.movie_id = m.id)
    and not exists (select 1 from public.night_rejections r where r.movie_id = m.id)
    and not exists (select 1 from public.movie_releases mr where mr.movie_id = m.id);
  get diagnostics v_movies = row_count;

  -- Runs after the movies delete on purpose: an orphan movie's movie_tags rows
  -- cascade away with it, which can leave tags that only it was using
  -- orphaned. Doing this second catches those in the same run.
  delete from public.tags t
  where t.fetched_at < now() - interval '1 day'
    and not exists (select 1 from public.movie_tags mt where mt.tag_id = t.id);
  get diagnostics v_tags = row_count;

  return jsonb_build_object(
    'releases', v_releases,
    'orphan_movies', v_movies,
    'orphan_tags', v_tags
  );
end;
$$;

-- The cron route is the only caller, and it runs with the service key. A
-- signed-in user calling this over RPC could not reach anyone's data, but could
-- delete catalog rows early. That is not theirs to trigger.
--
-- service_role gets an explicit grant after the revoke for the reason
-- 20260726154439_phase4_recommender.sql gives for _rebuild_tag_weights:
-- hosted Supabase's default privileges give service_role EXECUTE directly on
-- new functions and a fresh local stack gives it nothing. Revoking and then
-- granting explicitly makes both environments end up the same.
revoke execute on function public.prune_catalog(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.prune_catalog(timestamptz) to service_role;
