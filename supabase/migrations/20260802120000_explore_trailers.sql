-- Explore (post-phase-9 feature): a vertical trailer feed at /explore.
--
-- No table is created here, so CLAUDE.md's REVOKE-then-GRANT rule and the
-- "every new table gets RLS in the same migration" rule do not apply. Stated
-- rather than left implicit, because both are absolute rules and a reader
-- needs to see they were considered.
--
-- `movies` already carries `grant select on movies, ... to authenticated`
-- table-wide, not column-scoped (20260726002633_phase0_core.sql:178), so both
-- columns below are readable with no grant change. The same migration grants
-- service_role table-wide, so lib/movies/cache.ts can write them. This is the
-- identical argument 20260727200002_media_type_tv.sql:6-9 made for media_type.

alter table movies add column trailer_key text;

-- Two columns, not one. `trailer_key is null` is ambiguous between "this film
-- has no trailer on the provider" and "nobody has looked yet". Without a
-- separate timestamp, the backfill in lib/movies/explore.ts would re-query
-- every trailer-less title on every pass, forever. This is the same role
-- fetched_at plays on movie_releases and on movies itself.
alter table movies add column trailer_fetched_at timestamptz;
