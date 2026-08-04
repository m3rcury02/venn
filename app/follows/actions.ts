"use server";

import { revalidatePath } from "next/cache";
import { sendPush } from "@/lib/notifications/send";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type FollowActionResult = { ok: boolean; error?: string };

export async function followUser(targetUserId: string): Promise<FollowActionResult> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  if (me === targetUserId) {
    return { ok: false, error: "Cannot follow yourself." };
  }

  const { error } = await supabase
    .from("follows")
    .insert({ follower_id: me, followee_id: targetUserId });

  if (error) {
    return { ok: false, error: error.message };
  }

  const { data: followerProfile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", me)
    .maybeSingle();

  const followerName = followerProfile?.display_name || followerProfile?.username || "Someone";
  const url = followerProfile?.username ? `/u/${followerProfile.username}` : "/discover";

  sendPush(targetUserId, "new_follower", {
    title: "New follower",
    body: `${followerName} started following you`,
    url,
  });

  revalidatePath("/u/[username]", "page");
  revalidatePath("/discover");

  return { ok: true };
}

export async function unfollowUser(targetUserId: string): Promise<FollowActionResult> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", me)
    .eq("followee_id", targetUserId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/u/[username]", "page");
  revalidatePath("/discover");

  return { ok: true };
}

export async function blockUser(targetUserId: string): Promise<FollowActionResult> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  if (me === targetUserId) {
    return { ok: false, error: "Cannot block yourself." };
  }

  const { error } = await supabase.rpc("block_user", { target: targetUserId });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/u/[username]", "page");
  revalidatePath("/discover");

  return { ok: true };
}

export async function unblockUser(targetUserId: string): Promise<FollowActionResult> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", me)
    .eq("blocked_id", targetUserId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/u/[username]", "page");
  revalidatePath("/discover");

  return { ok: true };
}
