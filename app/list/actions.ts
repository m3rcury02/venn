"use server";

import { revalidatePath } from "next/cache";
import { cacheMovie } from "@/lib/movies/cache";
import { createClient } from "@/lib/supabase/server";

export type AddToListResult =
  | { status: "added" }
  | { status: "already-in-list" }
  | { status: "error"; message: string };

// A listId targets a group's list; without one the caller's own default list is
// used. The id is not trusted -- list_items_insert_via_list is the enforcement,
// as it is for the personal list.
export async function addToList(
  externalId: string,
  listId?: string,
): Promise<AddToListResult> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") {
    return { status: "error", message: "Not signed in." };
  }

  let targetListId = listId;
  if (!targetListId) {
    // Scoped to owner_user_id, not is_default alone: since phase 3 the lists
    // policy also returns group lists, and .single() would throw on two rows.
    const { data: list } = await supabase
      .from("lists")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("is_default", true)
      .single();
    if (!list) return { status: "error", message: "No default list found." };
    targetListId = list.id;
  }

  let movieId: string;
  try {
    movieId = await cacheMovie(externalId);
  } catch {
    return { status: "error", message: "Couldn't fetch movie details." };
  }

  const { error } = await supabase
    .from("list_items")
    .insert({ list_id: targetListId, movie_id: movieId, added_by: userId });

  if (error) {
    // 23505: already on this list -- not a failure the user needs to see as one.
    if (error.code === "23505") return { status: "already-in-list" };
    return { status: "error", message: "Couldn't add to list." };
  }

  // "/groups/[id]" is the page-file form: it invalidates every path matching
  // that dynamic route. Targeting "/groups" with type "layout" would not work
  // -- "layout" matches a layout *file*, and there is no app/groups/layout.tsx.
  revalidatePath(listId ? "/groups/[id]" : "/", "page");
  return { status: "added" };
}

export async function removeFromList(
  movieId: string,
  listId?: string,
): Promise<void> {
  const supabase = await createClient();

  let targetListId = listId;
  if (!targetListId) {
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (typeof userId !== "string") return;

    const { data: list } = await supabase
      .from("lists")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("is_default", true)
      .single();
    if (!list) return;
    targetListId = list.id;
  }

  await supabase
    .from("list_items")
    .delete()
    .eq("list_id", targetListId)
    .eq("movie_id", movieId);

  // "/groups/[id]" is the page-file form: it invalidates every path matching
  // that dynamic route. Targeting "/groups" with type "layout" would not work
  // -- "layout" matches a layout *file*, and there is no app/groups/layout.tsx.
  revalidatePath(listId ? "/groups/[id]" : "/", "page");
}
