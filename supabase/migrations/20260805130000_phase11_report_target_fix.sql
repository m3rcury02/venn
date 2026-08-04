-- Phase 11 fix: give a reported list item a real identity.
--
-- `list_items`' primary key is (list_id, movie_id) -- it has no single-column id.
-- The original reports migration let target_id carry only a list_id for a
-- 'list_item' report, which meant app/moderation/actions.ts's delete
-- (`.eq("list_id", target_id)`) removed every item in the list instead of the
-- one reported note. This adds the missing half of the key.

alter table reports
  add column target_movie_id uuid references movies (id) on delete set null;
-- ON DELETE SET NULL, not CASCADE: a report should survive the catalog row it
-- names, same reasoning movie_nights.picked_movie_id already uses.

alter table reports
  add constraint reports_target_movie_id_shape check (
    (target_type = 'list_item' and target_movie_id is not null)
    or (target_type <> 'list_item' and target_movie_id is null)
  );

-- The original unique index only covered (reporter_id, target_type, target_id),
-- which is now ambiguous for 'list_item' reports -- two different notes in the
-- same list share a target_id. Recreate over the full key. NULLS NOT DISTINCT
-- is required for the 'user'/'list' rows, where target_movie_id is always null:
-- without it, Postgres treats every NULL as distinct and the one-report-per-
-- target rule silently stops applying to users and lists.
drop index reports_one_per_reporter_idx;

create unique index reports_one_per_reporter_idx
  on reports (reporter_id, target_type, target_id, target_movie_id)
  nulls not distinct;
