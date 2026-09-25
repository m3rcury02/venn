import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { InviteAccept } from "@/components/invite-accept";
import type { InviteError } from "@/app/join/actions";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { INVITE_COOKIE, parseInviteCode } from "@/lib/invite";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Join a group — Venn",
};

// Reached only through the proxy's `/join/<code>` redirect, or from sign-in and
// onboarding while an invite is waiting (lib/invite.ts). Not a public path, so
// the proxy's sign-in and onboarding gates run first.
//
// The group's name isn't shown. A non-member can't read the group
// (groups_select_member), and a lookup by code for non-members would be a new
// SECURITY DEFINER function for one line of copy. The group page names it the
// moment the join lands.
const ERRORS: Record<InviteError, string> = {
  used: "This invite was already used on this device. Open the link you were sent again.",
  failed: "Something went wrong joining the group. Open the link you were sent again to retry.",
  unknown: "That invite doesn't match a group any more. Ask whoever sent it for a new link.",
};

type JoinPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function JoinPage({ searchParams }: JoinPageProps) {
  const supabase = await createClient();
  const { data } = await getClaims(supabase);
  if (!data?.claims) redirect("/login");

  const hasInvite = Boolean(parseInviteCode((await cookies()).get(INVITE_COOKIE)?.value));
  const { error } = await searchParams;
  // A fresh invite outranks the message from an earlier failed one.
  // hasOwn, not `in`: `in` also matches inherited keys like ?error=toString.
  const errorMessage =
    !hasInvite && error && Object.hasOwn(ERRORS, error) ? ERRORS[error as InviteError] : null;

  return (
    <Screen width="narrow">
      <AppHeader subtitle="Invite" />
      <Panel className="flex flex-col gap-5 p-6">
        {hasInvite ? (
          <>
            <h1 className="t-section text-[32px] text-fg">You&apos;ve been invited to a group</h1>
            <p className="t-body text-[15px] text-fg-dim">
              Your ratings join the group&apos;s, and on movie night Venn picks something every
              person there will sit through. You can leave the group whenever you like.
            </p>
            <InviteAccept />
          </>
        ) : errorMessage ? (
          <>
            <h1 className="t-section text-[32px] text-fg">Couldn&apos;t join</h1>
            <p role="alert" className="t-body text-[15px] text-beam-a">
              {errorMessage}
            </p>
            <Link href="/groups" className={buttonClass("ghost", "h-12 self-start py-0")}>
              Enter a code instead
            </Link>
          </>
        ) : (
          <>
            <h1 className="t-section text-[32px] text-fg">No invite waiting</h1>
            <p className="t-body text-[15px] text-fg-dim">
              Open the invite link you were sent again, or type its code on the Groups page.
            </p>
            <Link href="/groups" className={buttonClass("ghost", "h-12 self-start py-0")}>
              Go to Groups
            </Link>
          </>
        )}
      </Panel>
    </Screen>
  );
}
