"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { captureServer } from "@/lib/analytics/server";
import { INVITE_COOKIE, parseInviteCode } from "@/lib/invite";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type InviteError = "used" | "failed" | "unknown";

// The code comes from the httpOnly cookie the proxy set (lib/invite.ts), never
// from the form, so it is never in the page for anything client-side to read.
// The cookie is deleted whichever way this goes: a failed code won't succeed on
// a retry, and keeping it would send the user back here after every sign-in.
//
// Failures come back as ?error= rather than returned action state. Deleting a
// cookie in a server action makes Next re-render the route, and the re-render
// finds no invite and unmounts whatever was holding the error, so a returned
// message was replaced by "No invite waiting" before anyone could read it.
export async function acceptInvite() {
  const cookieStore = await cookies();
  const code = parseInviteCode(cookieStore.get(INVITE_COOKIE)?.value);
  cookieStore.delete(INVITE_COOKIE);
  if (!code) redirect("/join?error=used");

  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  // The same SECURITY DEFINER path as typing the code on /groups: an existing
  // member gets the group id back and no second row (on conflict do nothing).
  const { data: groupId, error } = await supabase.rpc("join_group_by_code", {
    p_code: code,
  });

  if (error) redirect("/join?error=failed");
  if (!groupId) redirect("/join?error=unknown");

  // `invite_link` against app/groups/actions.ts's `invite_code`: whether
  // sharing a link beats reading a code out is the thing to measure.
  await captureServer(userId, "group_joined", { group_id: groupId, via: "invite_link" });

  revalidatePath("/groups");
  redirect(`/groups/${groupId}`);
}

export async function dismissInvite() {
  (await cookies()).delete(INVITE_COOKIE);
  redirect("/");
}
