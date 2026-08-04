// SPEC §5's endpoint. `POST { text, url?, token, source? }`.
//
// The one route in this app that is not authenticated by cookie: an iOS
// Shortcut has no session, so the token IS the identity. It is therefore also
// one of the two places (with app/share/route.ts) that writes list_items as
// service_role -- see lib/ingest/resolve.ts.
//
// §5's governing rule shapes every branch here: "Never guess. A silent wrong
// add is worse than a badge." Auto-resolution fires only when the evidence
// names exactly one film; everything else lands in the Inbox.

import { after, NextResponse } from "next/server";
import { captureServer } from "@/lib/analytics/server";
import { resolveInBackground } from "@/lib/ingest/resolve";
import { verifyToken } from "@/lib/ingest/tokens";
import { createServiceClient } from "@/lib/supabase/service";

/** §3's `source` values. Phase 6 made all three reachable. */
const SOURCES = ["android_share", "ios_shortcut", "paste"] as const;
type Source = (typeof SOURCES)[number];

/**
 * §11: "Rate-limit /api/ingest per token."
 *
 * Departure, stated rather than glossed: this counts per USER, not per token.
 * §3 gives ingest_inbox no token_id column, and adding one purely to carry a
 * rate limit is more schema than the constraint justifies at 4-6 users. A user
 * with two tokens shares one budget, which is the safer direction to be wrong.
 */
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function toSource(raw: unknown): Source {
  return SOURCES.includes(raw as Source) ? (raw as Source) : "paste";
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : null;
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 401 });
  }

  const userId = await verifyToken(token);
  if (!userId) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  // §5's payload is { text, url? }; a share sheet often fills only one of them,
  // and the url is worth extracting from either way.
  const text = [body.text, body.url]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n")
    .trim();

  if (!text) {
    return NextResponse.json({ error: "nothing to ingest" }, { status: 400 });
  }

  const db = createServiceClient();

  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const { count } = await db
    .from("ingest_inbox")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since);

  if ((count ?? 0) >= RATE_LIMIT) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  // Inserted synchronously, BEFORE the response -- which is not the order §5
  // step 1 literally describes ("return 200 immediately", then insert).
  //
  // Deliberate. If this insert lived in after(), a failure would lose the share
  // silently with a 200 already sent, and the user would have no way to know.
  // The durable pending row is the entire basis for trusting the Inbox; only
  // *resolution* is safe to defer, and it is, below.
  const { data: row, error } = await db
    .from("ingest_inbox")
    .insert({ user_id: userId, raw_text: text, source: toSource(body.source) })
    .select("id")
    .single();

  if (error || !row) {
    return NextResponse.json({ error: "could not accept" }, { status: 500 });
  }

  const source = toSource(body.source);
  captureServer(userId, "ingest_received", { source });

  after(() => resolveInBackground(db, row.id, userId, text));

  return NextResponse.json({ id: row.id, status: "pending" });
}
