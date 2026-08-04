"use server";

import { revalidatePath } from "next/cache";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

/**
 * §5 step 6's other half: the user disambiguates. Runs as the authenticated
 * user -- ingest_inbox_update_own is the enforcement, and the grant limits the
 * write to (status, resolved_movie_id), so resolve and reject are structurally
 * the only two edits an inbox row can take.
 *
 * The route handler is service_role because it has no session; this does, so it
 * follows phase 1b's rule rather than the route's exception to it.
 */
export async function resolveInboxItem(id: string, movieId: string) {
  const supabase = await createClient();

  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return;

  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("owner_user_id", userId)
    .eq("is_default", true)
    .single();

  if (!list) return;

  // Duplicate is success, exactly as phase 1b decided for addToList: 23505 here
  // means the movie is already on the list, which is the state the user asked
  // for. Marking the row resolved below is still correct.
  const { error } = await supabase
    .from("list_items")
    .insert({ list_id: list.id, movie_id: movieId, added_by: userId });

  if (error && error.code !== "23505") return;

  await supabase
    .from("ingest_inbox")
    .update({ status: "resolved", resolved_movie_id: movieId })
    .eq("id", id);

  revalidatePath("/inbox");
  revalidatePath("/");
}

/** Not a delete. §5's point is that a share is never silently lost. */
export async function rejectInboxItem(id: string) {
  const supabase = await createClient();

  await supabase
    .from("ingest_inbox")
    .update({ status: "rejected" })
    .eq("id", id);

  revalidatePath("/inbox");
  revalidatePath("/");
}
