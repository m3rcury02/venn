import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/ingest is listed one path at a time, never as "/api": it authenticates
// with a token rather than a cookie (SPEC §5), so without it here the redirect
// below catches it. That failure is quiet and confusing -- a 307 preserves the
// POST method, so an iOS Shortcut would receive the /login page instead of JSON
// and report success.
//
// /share (phase 6) needs the same exemption for the same reason: it answers
// its own auth with a 303, which a browser correctly turns into a GET, and a
// 307 landing on /login first would defeat that.
//
// /manifest.webmanifest (phase 6) needs it for a different reason: browsers
// fetch a manifest without credentials by default, so a signed-out visitor's
// very first request for it would 307 to /login, the manifest would never
// parse, and the app would never be installable -- silently, with nothing in
// the console naming why.
//
// /sw.js and /offline (phase 7) need the same exemption as the manifest, for
// the same reason. The service worker's own fetch of /sw.js has no cookie
// context to rely on, so a 307 would hand the browser the /login HTML to
// parse as a script, and registration would fail silently. /offline is
// precached at install time by a fetch that runs in whatever auth state
// happens to be current -- if that fetch gets redirected to /login instead of
// the real offline page, every future offline navigation on this device would
// render the login screen from cache rather than the offline shell.
//
// /.well-known/assetlinks.json must also be readable without a session. Android
// fetches it to verify that the signed native wrapper may open this origin as a
// Trusted Web Activity; a login redirect would make verification fail.
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/api/ingest",
  "/share",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline",
  "/.well-known/assetlinks.json",
];

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
  const isOnboarding = request.nextUrl.pathname.startsWith("/onboarding");

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (data?.claims && !isPublic) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("onboarded_at")
      .eq("id", data.claims.sub)
      .maybeSingle();

    if (!profile?.onboarded_at && !isOnboarding) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }

    if (profile?.onboarded_at && isOnboarding) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
