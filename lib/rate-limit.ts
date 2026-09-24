import type { createClient } from "@/lib/supabase/server";

// Per-user rate limits for every request path that reaches TMDB. The budgets
// and the counting live in Postgres (consume_rate_limit in
// supabase/migrations/20260924140000_public_launch_hardening.sql): a Vercel
// function instance doesn't outlive its request, so an in-memory counter
// would never see a second hit.
export type RateLimitBucket =
  | "search"
  | "catalog"
  | "feed"
  | "detail"
  | "widen"
  | "import";

export class RateLimitedError extends Error {
  constructor() {
    super("Too many requests. Try again in a minute.");
    this.name = "RateLimitedError";
  }
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Records one hit against the caller's budget for `bucket` and reports whether
 * it is still inside it. Takes the user-scoped client: the function reads
 * auth.uid(), so the service client would have no one to count against.
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
