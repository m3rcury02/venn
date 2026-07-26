"use server";

import { revalidatePath } from "next/cache";
import { hashToken, mintToken } from "@/lib/ingest/tokens";
import { createClient } from "@/lib/supabase/server";

/**
 * `token` is present exactly once, in the response to the mint that created it.
 * It is never stored and never re-readable -- only its hash reaches the
 * database, so a lost token is reminted rather than recovered.
 */
export type TokenFormState = {
  error?: string;
  token?: string;
};

export async function createIngestToken(
  _prev: TokenFormState,
  formData: FormData,
): Promise<TokenFormState> {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return { error: "Name the device this token is for." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
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
