import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ANALYTICS_COOKIE } from "../analytics/cookie";
import { getClaims } from "./claims";

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
//
// /api/cron/digest (phase 11) and /api/cron/refresh-catalog are triggered by
// Vercel Cron without a session cookie, so they must be exempted from login
// redirects; authentication is checked via CRON_SECRET.
//
// /api/errors receives browser error reports (lib/errors/client.ts), and the
// pages that most need them are the login page and onboarding, where the
// caller has no session or isn't onboarded. Behind the redirect, a report
// would be answered with /login HTML and silently lost. It guards itself: see
// the route.
// Bumped from "1" when the 18+ confirmation joined the onboarding gate; see
// the comment in updateSession.
const ONBOARDED_COOKIE_VALUE = "2";

const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/api/ingest",
  "/api/cron/digest",
  "/api/cron/refresh-catalog",
  "/api/errors",
  "/share",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline",
  "/.well-known/assetlinks.json",
  "/privacy",
  "/terms",
  "/about",
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
  // published keys. lib/supabase/claims.ts wraps this with a module-scope JWKS
  // cache so that verification is local after the first call in a warm
  // instance -- it still calls supabase.auth.getClaims() with no jwt argument
  // underneath, so the getSession()-driven refresh above is unaffected.
  const { data } = await getClaims(supabase);

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
    // Onboarding is one-way -- once a user has completed it they never become
    // un-onboarded -- so a cookie set on the pass below lets every later
    // request skip this profiles query entirely. auth/signout clears the
    // cookie, so a different, non-onboarded account signing in on the same
    // browser still gets the redirect.
    //
    // "Onboarded" now also means "confirmed 18+" (public-launch hardening,
    // DPDP). The cookie value moved from "1" to "2" so every cookie set
    // before that is ignored, and those users go back through the proxy
    // query, which sends anyone who hasn't confirmed to the age step.
    const onboardedCookie =
      request.cookies.get("venn_onboarded")?.value === ONBOARDED_COOKIE_VALUE;

    if (!onboardedCookie) {
      const { data: row } = await supabase
        .from("profiles")
        .select("onboarded_at, age_confirmed_at")
        .eq("id", data.claims.sub)
        .maybeSingle();
      // Treating an unconfirmed user as "not onboarded" is what routes users
      // from before the age gate to it: app/onboarding/page.tsx shows the age
      // step first.
      const onboarded = Boolean(row?.onboarded_at && row?.age_confirmed_at);

      if (!onboarded && !isOnboarding) {
        const url = request.nextUrl.clone();
        url.pathname = "/onboarding";
        url.search = "";
        return NextResponse.redirect(url);
      }

      if (onboarded && isOnboarding) {
        const url = request.nextUrl.clone();
        url.pathname = "/";
        url.search = "";
        return NextResponse.redirect(url);
      }

      if (onboarded) {
        supabaseResponse.cookies.set("venn_onboarded", ONBOARDED_COOKIE_VALUE, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
        });
        // Readable by script, unlike the cookie above: see
        // lib/analytics/cookie.ts. It is a switch, not a credential -- forging
        // it only opts a browser *in* to analytics.
        supabaseResponse.cookies.set(ANALYTICS_COOKIE, "1", {
          sameSite: "lax",
          path: "/",
        });
      }
    } else if (isOnboarding) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
