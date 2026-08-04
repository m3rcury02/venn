-- Phase 11 fix: service_role grants for the weekly digest cron.
--
-- app/api/cron/digest/route.ts runs as createServiceClient() and reads
-- group_members (to find which groups a recipient belongs to) and groups (to
-- name them in the email, joined from movie_nights). Phase 3's
-- `revoke all on groups, group_members from anon, authenticated, service_role`
-- granted SELECT back to authenticated only -- no later migration granted
-- service_role anything on either table. Same gap explore_grants.sql patched
-- for user_movie_status and list_items after Explore hit it; this is the same
-- argument for the digest cron.

grant select on groups, group_members to service_role;
