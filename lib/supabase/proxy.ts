import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/ingest is listed one path at a time, never as "/api": it authenticates
// with a token rather than a cookie (SPEC §5), so without it here the redirect
// below catches it. That failure is quiet and confusing -- a 307 preserves the
// POST method, so an iOS Shortcut would receive the /login page instead of JSON
// and report success.
const PUBLIC_PATHS = ["/login", "/auth", "/api/ingest"];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims(). Removing this
  // call logs users out at random, because nothing refreshes the auth token.
  //
  // getClaims(), not getSession(): the session comes from cookies, which anyone
  // can spoof. getClaims() verifies the JWT signature against the project's
  // published keys.
  const { data } = await supabase.auth.getClaims();

  const isPublic = PUBLIC_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
