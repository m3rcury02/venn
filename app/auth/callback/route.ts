import { type NextRequest, NextResponse } from "next/server";
import { homeOrInvite, INVITE_COOKIE } from "@/lib/invite";
import { createClient } from "@/lib/supabase/server";

// Google (and any future OAuth provider) uses the PKCE code-exchange flow,
// not the token-hash flow app/auth/confirm/route.ts handles for magic links
// -- `code` comes back from Supabase after it round-trips through the
// provider's consent screen.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // An invite followed while signed out is waiting in a cookie (lib/invite.ts).
  // The proxy still sends a new account through onboarding first.
  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = homeOrInvite(request.cookies.get(INVITE_COOKIE)?.value);
  redirectTo.search = "";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(redirectTo);
  }

  redirectTo.pathname = "/login";
  redirectTo.searchParams.set("error", "link_invalid");
  return NextResponse.redirect(redirectTo);
}
