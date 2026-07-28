-- Deleting a group, reversing a deferral phase 3 stated three times over: that
-- migration's own grants comment says "No UPDATE or DELETE for anyone:
-- renaming, leaving and deleting groups are out of scope this phase, and
-- withholding the grant is how that stays true." Requested directly by the
-- user (an accidentally-created group has no other way to go away), so the
-- absence of a DELETE grant stops being the enforcement here. Leaving and
-- renaming a group are untouched and stay out of scope -- their grants stay
-- absent, and the "last owner leaves" question phase 3 flagged stays closed.
--
-- No table is created here, so CLAUDE.md's REVOKE-then-GRANT rule does not
-- apply (same reasoning as media_type_tv.sql). Phase 3 already ran
-- `revoke all on groups ... from anon, authenticated, service_role`, and
-- hosted default privileges only fire at table creation, so there is nothing
-- to revoke before granting.
--
-- No cascade grants are needed either: ON DELETE CASCADE runs as the system,
-- not as the deleting role, so it is not subject to that role's grants or RLS.
-- Every FK into groups already cascades -- group_members.group_id and
-- lists.owner_group_id (both phase3_groups.sql), and list_items.list_id into
-- lists (phase0_core.sql) -- so deleting a group already cleanly removes its
-- membership, its one list, and that list's items. Nothing else references
-- groups yet (movie_nights is phase 11, unbuilt).

grant delete on groups to authenticated;

-- created_by, not a group_members.role = 'owner' join: the two agree today
-- (handle_new_group is the only writer of role = 'owner', and there is no
-- ownership transfer), but created_by lives on the row being deleted, so this
-- needs no join and cannot go stale against a membership row. A plain policy
-- is enough -- unlike is_group_member or join_group_by_code, this rule needs
-- no SECURITY DEFINER escape from RLS, since the owner can already SELECT the
-- group being deleted.
create policy groups_delete_owner on groups
  for delete to authenticated
  using (created_by = (select auth.uid()));
