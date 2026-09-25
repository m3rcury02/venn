-- Per-network rate limits, alongside the per-user ones from
-- 20260924231422_public_launch_hardening.sql. That migration named the gap it
-- left: "What it doesn't stop is one person running many accounts." Every
-- fresh account arrives with a fresh budget, so the per-user limits alone cap
-- how fast one *account* can spend the TMDB quota every user shares, not how
-- fast one *person* can.
--
-- The other half of the fix is at signup (a Turnstile captcha on the
-- magic-link form, app/login). This half counts by client network, so a
-- script cycling accounts from one machine still hits one budget.
--
-- What's counted is not the raw IP. lib/rate-limit.ts sends an HMAC of the
-- address (IPv4) or of its /64 prefix (IPv6: one host is routinely handed a
-- whole /64 and can rotate within it for free), keyed by a secret the
-- database doesn't hold. A dump of this table alone can't be walked back to
-- addresses, and nothing here ever joins it to a user.
--
-- Budgets are the per-user ones multiplied, not equal to them. Carrier-grade
-- NAT is the norm on Indian mobile networks and campus Wi-Fi puts a hostel
-- behind one address, so many real people can share an IP. The per-user limit
-- still does the fine-grained work; this one only has to stop a single source
-- from multiplying it. ~5x is five people at full tilt on one address, which
-- no real household reaches.
--
--   bucket   per user        per network
--   search   60 / min        300 / min
--   catalog  100 / 10 min    500 / 10 min
--   feed     30 / min        150 / min
--   detail   120 / min       600 / min
--   widen    20 / min        100 / min
--   import   120 / min       600 / min
--   errors   (none)          30 / min    /api/errors, which is public
--
-- `errors` has no per-user twin: the client error endpoint takes reports from
-- signed-out pages too (login is where a broken build hurts most), so a
-- network budget is the only one it can have.

create table ip_rate_limit_hits (
  ip_key       text        not null,
  bucket       text        not null,
  window_start timestamptz not null,
  hits         int         not null default 0,
  primary key (ip_key, bucket, window_start)
);

-- For the sweep below.
create index ip_rate_limit_hits_window_idx on ip_rate_limit_hits (window_start);

-- Same shape as rate_limit_hits: RLS on, no policies, no grants. The function
-- is the only way in.
alter table ip_rate_limit_hits enable row level security;
revoke all on ip_rate_limit_hits from anon, authenticated, service_role;

-- Called by the server only (service_role), never by a signed-in user: the
-- key comes from a request header that only the server can read trustworthily
-- (Vercel overwrites x-forwarded-for), and a user who could call this could
-- charge someone else's network or pass a fresh key per call.
create function public.consume_ip_rate_limit(p_ip_key text, p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max int;
  v_window_seconds int;
  v_window_start timestamptz;
  v_hits int;
begin
  if p_ip_key is null or length(p_ip_key) < 16 then
    raise exception 'invalid key' using errcode = '22023';
  end if;

  select b.max_hits, b.window_seconds into v_max, v_window_seconds
  from (values
    ('search',  300, 60),
    ('catalog', 500, 600),
    ('feed',    150, 60),
    ('detail',  600, 60),
    ('widen',   100, 60),
    ('import',  600, 60),
    ('errors',  30,  60)
  ) as b (bucket, max_hits, window_seconds)
  where b.bucket = p_bucket;

  if v_max is null then
    raise exception 'unknown rate limit bucket' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds
  );

  insert into public.ip_rate_limit_hits (ip_key, bucket, window_start, hits)
  values (p_ip_key, p_bucket, v_window_start, 1)
  on conflict (ip_key, bucket, window_start)
    do update set hits = public.ip_rate_limit_hits.hits + 1
  returning hits into v_hits;

  -- Unlike rate_limit_hits (one row per user, cleaned up on that user's next
  -- call), a network may never come back, so its last window would sit here
  -- forever. Sweep anything older than the longest window. The index keeps
  -- this a range scan that finds nothing most of the time.
  delete from public.ip_rate_limit_hits
  where window_start < now() - interval '1 hour';

  return v_hits <= v_max;
end;
$$;

revoke execute on function public.consume_ip_rate_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_ip_rate_limit(text, text)
  to service_role;
