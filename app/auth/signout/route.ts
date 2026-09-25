import { type NextRequest, NextResponse } from "next/server";
import { ANALYTICS_COOKIE } from "@/lib/analytics/cookie";
import { INVITE_COOKIE } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const response = NextResponse.redirect(url, { status: 303 });
  // Otherwise a different, non-onboarded account signing in on this browser
  // would skip proxy.ts's onboarding redirect entirely -- see the comment
  // there on venn_onboarded.
  response.cookies.delete("venn_onboarded");
  response.cookies.delete(ANALYTICS_COOKIE);
  // An invite this browser hasn't used yet belongs to whoever followed it,
  // not to the next account that signs in here.
  response.cookies.delete(INVITE_COOKIE);
  return response;
}
