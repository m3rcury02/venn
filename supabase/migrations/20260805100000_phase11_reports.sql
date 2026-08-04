-- Phase 11: Moderation reports table & service_role moderation grants.
--
-- SPEC §11: "report button, block user, username blocklist, admin delete view."
-- This migration creates the `reports` table for user moderation reports and
-- grants explicit privileges to `authenticated` and `service_role`.

-- ---------------------------------------------------------------- tables

create table reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid not null references profiles (id) on delete cascade,
  target_type  text not null check (target_type in ('user','list','list_item')),
  -- target_id is deliberately NOT a foreign key: it points at one of three
  -- different tables (profiles, lists, or list_items) depending on target_type,
  -- and a polymorphic foreign key constraint cannot be enforced in Postgres.
  target_id    uuid not null,
  reason       text not null check (length(reason) between 1 and 1000),
  status       text not null default 'open' check (status in ('open','actioned','dismissed')),
  created_at   timestamptz not null default now()
);

create index reports_status_idx on reports (created_at desc) where status = 'open';
create unique index reports_one_per_reporter_idx
  on reports (reporter_id, target_type, target_id);

-- --------------------------------------------------------------- grants

-- Revoke default privileges on the new table across environments to ensure
-- identical two-gate enforcement on local and remote Supabase stacks.
revoke all on reports from anon, authenticated, service_role;

-- A reporter can create and view their own reports. No UPDATE or DELETE grant is
-- given to authenticated users so reporters cannot alter or retract submitted reports.
grant select, insert on reports to authenticated;

-- Grants for service_role admin moderation view (/moderation actions.ts).
-- Precedent: explore_grants.sql. The admin view runs as createServiceClient()
-- and requires read/write access on reports, profiles, lists, and list_items.
grant select, update on reports to service_role;
grant select on profiles to service_role;
grant select, update on lists to service_role;
grant select, delete on list_items to service_role;

-- ------------------------------------------------------------------ RLS

alter table reports enable row level security;

create policy reports_select_own on reports
  for select to authenticated
  using (reporter_id = (select auth.uid()));

create policy reports_insert_own on reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()));
