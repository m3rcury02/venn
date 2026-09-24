import type { createServiceClient } from "@/lib/supabase/service";

/**
 * §11: "Rate-limit /api/ingest per token."
 *
 * Departure, stated rather than glossed: this counts per USER, not per token.
 * §3 gives ingest_inbox no token_id column, and adding one purely to carry a
 * rate limit is more schema than the constraint justifies. A user with two
 * tokens shares one budget, which is the safer direction to be wrong.
 *
 * Counts every ingest_inbox row, whatever its source, so /api/ingest (the
 * iOS Shortcut) and /share (the Android share target) draw on one budget.
 * /share used to skip this check, although each share resolves against TMDB
 * the same way. Counted in ingest_inbox rather than lib/rate-limit.ts because
 * /api/ingest authenticates with a token, not a session, and
 * consume_rate_limit reads auth.uid().
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

export async function ingestRateLimited(
  db: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<boolean> {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("ingest_inbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  return (count ?? 0) >= RATE_LIMIT;
}
