"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type GroupFormState = { error?: string };

export async function createGroup(
  _prev: GroupFormState,
  formData: FormData,
): Promise<GroupFormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Give the group a name." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return { error: "Not signed in." };

  // The id is generated here rather than read back from .insert().select().
  // handle_new_group is an AFTER ROW trigger, so the caller's membership row
  // does not exist yet when INSERT ... RETURNING evaluates groups_select_member
  // -- the returned row would be filtered out. Knowing the id up front avoids
  // that entirely and gives us somewhere to redirect.
  const id = crypto.randomUUID();
  const { error } = await supabase
    .from("groups")
    .insert({ id, name, created_by: userId });

  if (error) return { error: "Couldn't create the group." };

  revalidatePath("/groups");
  redirect(`/groups/${id}`);
}

export async function joinGroup(
  _prev: GroupFormState,
  formData: FormData,
): Promise<GroupFormState> {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Enter an invite code." };

  const supabase = await createClient();
  const { data: groupId, error } = await supabase.rpc("join_group_by_code", {
    p_code: code,
  });

  if (error) return { error: "Couldn't join the group." };
  if (!groupId) return { error: "No group with that code." };

  revalidatePath("/groups");
  redirect(`/groups/${groupId}`);
}
