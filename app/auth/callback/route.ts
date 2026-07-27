import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Google (and any future OAuth provider) uses the PKCE code-exchange flow,
// not the token-hash flow app/auth/confirm/route.ts handles for magic links
// -- `code` comes back from Supabase after it round-trips through the
// provider's consent screen.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  const redirectTo = request.nextUrl.clone();
  redirectTo.pathname = "/";
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
