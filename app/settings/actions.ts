"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { hashToken, mintToken } from "@/lib/ingest/tokens";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * `token` is present exactly once, in the response to the mint that created it.
 * It is never stored and never re-readable -- only its hash reaches the
 * database, so a lost token is reminted rather than recovered.
 */
export type TokenFormState = {
  error?: string;
  token?: string;
};

export type ProfileFormState = { error?: string };

// Groups are where this name is seen -- member chips and "added by" on every
// group page -- but the edit itself lives here with the rest of profile-shaped
// settings (SPEC §7 screen 11). Onboarding (which also sets username and
// display_name) is phase 8. profiles_update_own already permits this write.
export async function setDisplayName(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const displayName = String(formData.get("display_name") ?? "").trim();
  if (!displayName) return { error: "Enter a name." };

  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return { error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", userId);

  if (error) return { error: "Couldn't save that name." };

  // The name appears on both screens: the form's own value here, and the member
  // chips plus "added by" on every group page.
  revalidatePath("/settings");
  revalidatePath("/groups/[id]", "page");
  return {};
}

export async function createIngestToken(
  _prev: TokenFormState,
  formData: FormData,
): Promise<TokenFormState> {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { error: "Name the device this token is for." };

  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return { error: "Not signed in." };

  const token = mintToken();

  // Runs as the authenticated user, not service_role: ingest_tokens_insert_own
  // is the enforcement, matching every other mutation since phase 1b. The route
  // handler is the only thing in this phase that has no session to run as.
  const { error } = await supabase
    .from("ingest_tokens")
    .insert({ user_id: userId, token_hash: hashToken(token), label });

  if (error) return { error: "Couldn't create the token." };

  revalidatePath("/settings");

  // Returned to the client component that rendered the form. It deliberately
  // does not travel back through the revalidated server component -- a token in
  // page HTML would be re-sent on every navigation to /settings.
  return { token };
}

export async function revokeIngestToken(
  _prev: TokenFormState,
  formData: FormData,
): Promise<TokenFormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "No token to revoke." };

  const supabase = await createClient();

  // Revoked, not deleted: the grant on this table permits UPDATE (revoked_at)
  // and no DELETE at all, so this is the only edit that exists.
  const { error } = await supabase
    .from("ingest_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { error: "Couldn't revoke that token." };

  revalidatePath("/settings");
  return {};
}

export type ListVisibility = "public" | "followers" | "private";

export async function setListVisibility(
  visibility: ListVisibility,
): Promise<ProfileFormState> {
  if (
    visibility !== "public" &&
    visibility !== "followers" &&
    visibility !== "private"
  ) {
    return { error: "Invalid visibility choice." };
  }

  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return { error: "Not signed in." };

  const [profileRes, listRes] = await Promise.all([
    supabase
      .from("profiles")
      .update({ default_list_visibility: visibility })
      .eq("id", userId),
    supabase
      .from("lists")
      .update({ visibility })
      .eq("owner_user_id", userId)
      .eq("is_default", true),
  ]);

  if (profileRes.error || listRes.error) {
    return { error: "Couldn't update visibility setting." };
  }

  revalidatePath("/settings");
  revalidatePath("/u/[username]", "page");
  revalidatePath("/discover");
  return {};
}

export async function deleteAccount(
  confirmation: string,
): Promise<{ error?: string }> {
  if (confirmation !== "DELETE") {
    return { error: 'Type "DELETE" to confirm.' };
  }

  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") {
    return { error: "Not signed in." };
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.deleteUser(userId);

  if (error) {
    return { error: "Couldn't delete account. Please try again." };
  }

  const cookieStore = await cookies();
  cookieStore.delete("venn_onboarded");

  redirect("/login");
}
