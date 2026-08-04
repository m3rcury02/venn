import { type NextRequest, NextResponse } from "next/server";
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
  return response;
}
