import { NextResponse } from "next/server";
import { refreshStaleCatalog } from "@/lib/movies/refresh";

// Daily, from vercel.json. Keeps cached TMDB data inside TMDB's 6-month limit
// (API Terms of Use, section 1.C); the reasoning lives in lib/movies/refresh.ts
// and docs/DECISIONS.md.
//
// Same CRON_SECRET check as app/api/cron/digest: Vercel sends it as a bearer
// token on every cron invocation, and without it anyone could make this route
// spend TMDB calls.
export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await refreshStaleCatalog();
    return NextResponse.json({ ok: true, ...report });
  } catch (error) {
    console.error("refresh-catalog: run failed", error);
    return NextResponse.json({ error: "Refresh failed." }, { status: 500 });
  }
}
