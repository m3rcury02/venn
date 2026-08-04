// SPEC §5's Android half: the Web Share Target declared in
// public/manifest.webmanifest points here. The installed PWA carries the
// user's cookie, so this path needs no token at all -- it is the same
// resolution engine as /api/ingest (lib/ingest/resolve.ts), reached by a
// session instead of a token.
//
// Every response is a 303, not a 307: a 307 preserves the POST method, which
// would make the browser re-POST to a GET-only page -- the same trap phase 5
// documented for the proxy's own redirect.
//
// Unverified assumption, recorded in docs/DECISIONS.md: Supabase's auth
// cookies are SameSite=Lax, and the share-target launch is a POST navigation
// from outside this origin's own pages. Whether Chrome classifies that as
// same-site (so the cookie rides along) cannot be confirmed from this
// environment -- see DECISIONS.md phase 6 for the fallback if it does not.

import { after, NextResponse } from "next/server";
import { captureServer } from "@/lib/analytics/server";
import { resolveInBackground } from "@/lib/ingest/resolve";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  const url = new URL(request.url);

  const supabase = await createClient();
  const { data } = await getClaims(supabase);
  const userId = data?.claims?.sub;

  if (!userId) {
    url.pathname = "/login";
    return NextResponse.redirect(url, { status: 303 });
  }

  const form = await request.formData();
  const title = form.get("title");
  const text = form.get("text");
  const sharedUrl = form.get("url");

  const combined = [title, text, sharedUrl]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n")
    .trim();

  url.pathname = "/inbox";
  url.search = "";

  // Nothing to ingest is not an error -- there is nowhere to send the user but
  // back to the Inbox, and no row to create.
  if (!combined) {
    return NextResponse.redirect(url, { status: 303 });
  }

  const db = createServiceClient();

  // Hardcoded, not read from the form: this route IS the Android path, so a
  // client-supplied value would be spoofable and would defeat the one purpose
  // the column exists for (§5: "instrument every ingest with its source").
  const { data: row, error } = await db
    .from("ingest_inbox")
    .insert({ user_id: userId, raw_text: combined, source: "android_share" })
    .select("id")
    .single();

  if (error || !row) {
    return NextResponse.redirect(url, { status: 303 });
  }

  // after(), not a bare un-awaited call: see app/api/ingest/route.ts for why.
  after(async () => {
    await captureServer(userId, "ingest_received", { source: "android_share" });
    await resolveInBackground(db, row.id, userId, combined);
  });

  return NextResponse.redirect(url, { status: 303 });
}
