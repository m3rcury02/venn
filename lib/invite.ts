// Invite links: `/join/<code>` is what a member shares. It never renders.
// lib/supabase/proxy.ts moves the code into this cookie and redirects to a
// bare `/join` (or `/welcome?invite=1` when signed out), so the code is
// never in the address bar of a rendered page. The code is a bearer
// credential for joining the group, and components/analytics.tsx sends every
// pathname to PostHog.
//
// The cookie then has to outlive sign-in and onboarding, which is why it is a
// cookie and not a `next` parameter: Google OAuth and the magic-link email
// each bounce through their own fixed return URL, and the proxy sends a new
// account through the age step and onboarding before any page it asked for.
// The two auth routes and the two onboarding exits send the user to `/join`
// while it is set. app/join/actions.ts deletes it on join or dismiss, and
// app/auth/signout/route.ts on sign-out, so it can't follow the next person
// on a shared device.
//
// Its own module, with no next/headers import, because the proxy reads it.
export const INVITE_COOKIE = "venn_invite";

// A day covers a magic link sitting unread for a while. A new account is
// through onboarding in minutes.
export const INVITE_MAX_AGE_SECONDS = 60 * 60 * 24;

// groups.invite_code is 8 uppercase hex characters (phase 3 migration).
// Wider than that, so a future format change doesn't need this to change
// too; join_group_by_code does the real matching, with upper(trim()).
const INVITE_CODE = /^[A-Z0-9]{4,32}$/;

export function parseInviteCode(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase();
  return code && INVITE_CODE.test(code) ? code : null;
}

// Where sign-in and onboarding land: the waiting invite if there is one,
// home otherwise.
export function homeOrInvite(cookieValue: string | undefined): "/" | "/join" {
  return parseInviteCode(cookieValue) ? "/join" : "/";
}
