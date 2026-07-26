"use server";

import { revalidatePath } from "next/cache";
import { cacheMovie } from "@/lib/movies/cache";
import { createClient } from "@/lib/supabase/server";

export type AddToListResult =
  | { status: "added" }
  | { status: "already-in-list" }
  | { status: "error"; message: string };

export async function addToList(externalId: string): Promise<AddToListResult> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") {
    return { status: "error", message: "Not signed in." };
  }

  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("is_default", true)
    .single();
  if (!list) return { status: "error", message: "No default list found." };

  let movieId: string;
  try {
    movieId = await cacheMovie(externalId);
  } catch {
    return { status: "error", message: "Couldn't fetch movie details." };
  }

  const { error } = await supabase
    .from("list_items")
    .insert({ list_id: list.id, movie_id: movieId, added_by: userId });

  if (error) {
    // 23505: already on this list -- not a failure the user needs to see as one.
    if (error.code === "23505") return { status: "already-in-list" };
    return { status: "error", message: "Couldn't add to list." };
  }

  revalidatePath("/");
  return { status: "added" };
}

export async function removeFromList(movieId: string): Promise<void> {
  const supabase = await createClient();

  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("is_default", true)
    .single();
  if (!list) return;

  await supabase
    .from("list_items")
    .delete()
    .eq("list_id", list.id)
    .eq("movie_id", movieId);

  revalidatePath("/");
}
