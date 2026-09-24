import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import type { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Rate limits for every request path that reaches TMDB, counted twice: per
// user and per client network. The budgets and the counting live in Postgres
// (consume_rate_limit in 20260924231422_public_launch_hardening.sql,
// consume_ip_rate_limit in 20260925000200_ip_rate_limits.sql): a Vercel
// function instance doesn't outlive its request, so an in-memory counter
// would never see a second hit.
//
// The per-user budget alone resets with every new account, so one person
// running many accounts from one machine multiplied it. The network budget is
// what they share.
export type RateLimitBucket =
  | "search"
  | "catalog"
  | "feed"
  | "detail"
  | "widen"
  | "import";

/** Buckets that exist only per network: paths with no signed-in user. */
export type NetworkRateLimitBucket = RateLimitBucket | "errors";

export class RateLimitedError extends Error {
  constructor() {
    super("Too many requests. Try again in a minute.");
    this.name = "RateLimitedError";
  }
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Records one hit against the caller's budget for `bucket`, and one against
 * their network's, and reports whether both are still inside. Takes the
 * user-scoped client: consume_rate_limit reads auth.uid(), so the service
 * client would have no one to count against.
 *
 * Fails open. If the counter itself errors (a blip talking to Postgres), the
 * request goes ahead. Refusing would turn a database hiccup into a broken
 * search box for every user, and the limit only matters against sustained
 * abuse, which a single missed count doesn't let through.
 */
export async function withinRateLimit(
  supabase: Supabase,
  bucket: RateLimitBucket,
): Promise<boolean> {
  const [user, network] = await Promise.all([
    withinUserLimit(supabase, bucket),
    withinNetworkLimit(bucket),
  ]);
  return user && network;
}

async function withinUserLimit(
  supabase: Supabase,
  bucket: RateLimitBucket,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_bucket: bucket,
  });
  if (error) {
    console.error("[venn] rate limit check failed", bucket, error.message);
    return true;
  }
  return data !== false;
}

/** withinRateLimit, for callers whose failure path is a throw. */
export async function assertRateLimit(
  supabase: Supabase,
  bucket: RateLimitBucket,
): Promise<void> {
  if (!(await withinRateLimit(supabase, bucket))) throw new RateLimitedError();
}

/**
 * The per-network half, on its own for callers with no user (/api/errors).
 * Fails open like the per-user half, and also when there is no client address
 * to count: outside a request (the smoke scripts) or on a local dev server.
 */
export async function withinNetworkLimit(
  bucket: NetworkRateLimitBucket,
): Promise<boolean> {
  const key = await networkKey();
  if (!key) return true;

  // service_role only: see the migration for why a user can't call this.
  const { data, error } = await createServiceClient().rpc("consume_ip_rate_limit", {
    p_ip_key: key,
    p_bucket: bucket,
  });
  if (error) {
    console.error("[venn] network rate limit check failed", bucket, error.message);
    return true;
  }
  return data !== false;
}

async function networkKey(): Promise<string | null> {
  let requestHeaders: Headers;
  try {
    requestHeaders = await headers();
  } catch {
    return null;
  }

  const network = clientNetwork(requestHeaders);
  if (!network) return null;

  // An HMAC, never the address itself: the table only needs to tell networks
  // apart, not know which they are. RATE_LIMIT_IP_SECRET is the intended key;
  // the service-role key stands in when it's unset, so the limit can't be
  // switched off by a missing env var. Either way the database never holds the
  // key, so its rows alone can't be walked back to addresses. Rotating it
  // only resets the counters.
  const secret = process.env.RATE_LIMIT_IP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  return createHmac("sha256", secret).update(`venn-rate-limit:${network}`).digest("base64url");
}

/**
 * The client's address, or its /64 for IPv6. Read from x-forwarded-for, which
 * Vercel overwrites with the real client address on every request, so a
 * client can't choose its own. Behind any other host this header is
 * client-controlled and the per-network limit would be trivially dodged.
 */
export function clientNetwork(requestHeaders: Headers): string | null {
  const raw =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip")?.trim();
  if (!raw) return null;
  if (!raw.includes(":")) return raw;

  const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  return ipv6Prefix64(raw);
}

// One IPv6 host is routinely assigned a whole /64 and can pick a fresh
// address inside it for every request, so the /64 is what identifies it.
function ipv6Prefix64(address: string): string {
  const bare = address.split("%")[0];
  const halves = bare.split("::");
  if (halves.length > 2) return bare;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // A trailing dotted IPv4 part (::1.2.3.4) fills two groups.
  const width = (parts: string[]) =>
    parts.length + (parts.at(-1)?.includes(".") ? 1 : 0);

  const groups =
    halves.length === 2
      ? [...head, ...Array(Math.max(0, 8 - width(head) - width(tail))).fill("0"), ...tail]
      : head;
  const prefix = groups.slice(0, 4);
  if (prefix.length < 4 || prefix.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return bare;

  return `${prefix.map((g) => parseInt(g, 16).toString(16)).join(":")}::/64`;
}
