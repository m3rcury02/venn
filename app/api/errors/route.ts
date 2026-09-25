import { NextResponse, type NextRequest } from "next/server";
import { reportError } from "@/lib/errors/report";
import { withinNetworkLimit } from "@/lib/rate-limit";

// Receives browser-side errors from lib/errors/client.ts and forwards them to
// PostHog through the same reporter server errors use. Public (listed in
// lib/supabase/proxy.ts's PUBLIC_PATHS): the login page has no session and is
// among the pages most worth hearing about.
//
// Being public, it's also a way to spend PostHog's event quota from outside,
// so: same-origin only, a size cap, and a per-network budget.

const MAX_BODY_BYTES = 16 * 1024;

function field(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined;
}

export async function POST(request: NextRequest) {
  // Browsers send Sec-Fetch-Site on every fetch and don't let a page set it;
  // Origin is the fallback for the few that predate it. Neither stops a
  // script outside a browser, which is what the budget below is for.
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const sameOrigin =
    fetchSite !== null ? fetchSite === "same-origin" : origin === request.nextUrl.origin;
  if (!sameOrigin) return new NextResponse(null, { status: 403 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });

  if (!(await withinNetworkLimit("errors"))) {
    return new NextResponse(null, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const message = field(body.message, 4000);
  if (!message) return new NextResponse(null, { status: 400 });

  const error = new Error(message);
  error.name = field(body.name, 200) ?? "Error";
  error.stack = field(body.stack, 4000) ?? "";

  await reportError(error, {
    source: "client",
    path: field(body.path, 500),
    digest: field(body.digest, 100),
    mechanism: field(body.mechanism, 50),
    sessionId: field(body.sessionId, 64),
  });

  return new NextResponse(null, { status: 204 });
}
