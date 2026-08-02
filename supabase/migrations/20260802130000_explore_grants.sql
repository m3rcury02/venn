-- Explore (post-phase-9 feature): service_role read grants for the feed.
--
-- lib/movies/explore.ts reads three things through the service client: the
-- caller's user_movie_status rows (to drop already-voted titles), the caller's
-- default list, and its list_items (for isInList). Phase 5 granted service_role
-- `select on lists` and `insert on list_items` for exactly what ingest needed,
-- with the comment "their absence was a real bug" -- this migration is the same
-- argument, for the same reason, two more tables over.
--
-- No REVOKE here, despite the repo's revoke-then-grant rule: that rule exists
-- because local and hosted Supabase default in opposite directions for *new*
-- tables. These tables already exist with their phase 0 grants to authenticated
-- (`select, insert, update, delete`), which are exactly right and must not be
-- touched -- the revoke would strip them and break every vote and list flow.
--
-- Scoped to SELECT and nothing else, keeping phase 5's discipline ("No UPDATE
-- or DELETE anywhere"): exploreFeed only reads. All user writes -- votes, list
-- membership -- still go through the authenticated client and RLS, exactly as
-- they did before this migration. The service key gains read access to vote
-- rows, which is the same trust domain phase 5 already accepted for profiles
-- and lists: the key is server-side only, and exploreFeed filters by an
-- explicitly-passed user_id that the server actions resolve from the session,
-- not from client input.

grant select on user_movie_status to service_role;
grant select on list_items to service_role;
