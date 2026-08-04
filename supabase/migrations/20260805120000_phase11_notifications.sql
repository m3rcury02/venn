-- Phase 11: Notification preferences and Web Push subscriptions.
--
-- Note: `push_subscriptions` is not listed in SPEC §3. It is a necessary additions
-- because the Web Push standard (RFC 8030 / VAPID) requires storing a per-device
-- subscription endpoint, p256dh, and auth key per user.

-- ---------------------------------------------------------------- tables

create table notification_prefs (
  user_id   uuid not null references profiles (id) on delete cascade,
  category  text not null check (category in
              ('watch_confirmation','night_invite','new_follower',
               'friend_added','weekly_digest')),
  push      boolean not null,
  email     boolean not null,
  primary key (user_id, category)
);

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_user_idx on push_subscriptions (user_id);

-- --------------------------------------------------------------- grants

revoke all on notification_prefs, push_subscriptions from anon, authenticated, service_role;

grant select, insert, update, delete on notification_prefs to authenticated;
grant select, insert, delete on push_subscriptions to authenticated;

-- service_role grants: sendPush & digest read prefs; sendPush prunes stale endpoints
grant select on notification_prefs to service_role;
grant select, delete on push_subscriptions to service_role;

-- WP6's digest walks follow edges via service_role client from a Vercel cron
grant select on follows to service_role;

-- ------------------------------------------------------------------ RLS

alter table notification_prefs enable row level security;
alter table push_subscriptions  enable row level security;

create policy notification_prefs_own on notification_prefs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy push_subscriptions_own on push_subscriptions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
