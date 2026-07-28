-- Leaving a group. The second half of the same phase 3 deferral the previous
-- migration reversed for delete: "No UPDATE or DELETE for anyone: renaming,
-- leaving and deleting groups are out of scope this phase, and withholding the
-- grant is how that stays true." Requested directly by the user -- a member who
-- joined by invite code has no way out, and only the creator's Delete existed.
-- Renaming a group is untouched and stays out of scope; group_members still
-- gains no INSERT or UPDATE grant, so both write paths into it remain the
-- SECURITY DEFINER functions (handle_new_group, join_group_by_code).
--
-- This closes the "last owner leaves" question phase 3 flagged, by
-- construction rather than by omission: the owner cannot leave, so a group
-- always keeps its owner until that owner deletes it. There is no such thing
-- as an ownerless or memberless group.
--
-- No REVOKE block -- no table is created here, so CLAUDE.md's REVOKE-then-GRANT
-- rule does not apply (same reasoning as media_type_tv.sql and
-- group_delete.sql). Phase 3 already ran `revoke all on ... group_members from
-- anon, authenticated, service_role`, and hosted default privileges only fire
-- at table creation.
--
-- No cascade to think about either, in the other direction from group_delete:
-- nothing has an FK into group_members (its PK is the composite
-- (group_id, user_id), and grepping the migrations for `references
-- group_members` finds nothing). In particular list_items.added_by references
-- profiles, not membership -- so the movies a leaver added stay on the group's
-- list, which is the intent. What does change is readability of their name:
-- profiles_select_visible only exposes a profile to shared-group peers, so once
-- the membership row is gone `added by <name>` falls back to the "Member"
-- default the group page already renders.

grant delete on group_members to authenticated;

-- Two clauses, two rules. `user_id = auth.uid()` is the whole of what stops a
-- member kicking another member -- removing someone else stays unbuilt, and
-- this grant deliberately does not enable it. `role <> 'owner'` is what stops
-- the creator leaving; written as <> rather than = 'member' so it stays correct
-- if group_role ever gains a third value.
--
-- The predicate is on the row being deleted, which is the same principle
-- groups_delete_owner used when it chose groups.created_by over a
-- group_members.role join -- there, `role` would have been a join; here the row
-- being deleted *is* the membership row, so `role` is the on-row column and
-- `created_by` would be the join. The two policies cannot disagree about who
-- the owner is: handle_new_group is the only writer of role = 'owner' and it
-- writes it for new.created_by.
--
-- A plain policy, not SECURITY DEFINER: the caller can already SELECT their own
-- membership row through group_members_select_peers, so there is no RLS
-- recursion or unreadable row to escape.
create policy group_members_delete_self on group_members
  for delete to authenticated
  using (user_id = (select auth.uid()) and role <> 'owner');
