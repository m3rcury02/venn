"use server";

import { revalidatePath } from "next/cache";
import { setWatched, type Hype, type Rating } from "@/app/status/actions";
import { captureServer } from "@/lib/analytics/server";
import { cacheMovieForUser } from "@/lib/movies/cache";
import { RateLimitedError } from "@/lib/rate-limit";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

type MovieVoteState = {
  movieId: string;
  watched: boolean;
  rating: Rating | null;
  hype: Hype | null;
};

export type AddToListResult =
  | ({ status: "added" | "already-in-list" } & MovieVoteState)
  | { status: "error"; message: string };

// A listId targets a group's list; without one the caller's own default list is
// used. The id is not trusted -- list_items_insert_via_list is the enforcement,
// as it is for the personal list.
export async function addToList(
  externalId: string,
  listId?: string,
): Promise<AddToListResult> {
  const supabase = await createClient();

  const { data: claims } = await getClaims(supabase);
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
    movieId = await cacheMovieForUser(supabase, externalId);
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof RateLimitedError
          ? error.message
          : "Couldn't fetch movie details.",
    };
  }

  const { error } = await supabase
    .from("list_items")
    .insert({ list_id: targetListId, movie_id: movieId, added_by: userId });

  // 23505: already on this list -- not a failure the user needs to see as one.
  if (error && error.code !== "23505") {
    return { status: "error", message: "Couldn't add to list." };
  }

  if (!error) {
    const mediaType = externalId.startsWith("tv-") ? "tv" : "movie";
    await captureServer(userId, "movie_added", { media_type: mediaType });
  }

  const { data: vote, error: voteError } = await supabase
    .from("user_movie_status")
    .select("watched, rating, hype")
    .eq("user_id", userId)
    .eq("movie_id", movieId)
    .maybeSingle();
  if (voteError) {
    return { status: "error", message: "Couldn't load your movie status." };
  }

  // "/groups/[id]" is the page-file form: it invalidates every path matching
  // that dynamic route. Targeting "/groups" with type "layout" would not work
  // -- "layout" matches a layout *file*, and there is no app/groups/layout.tsx.
  revalidatePath(listId ? "/groups/[id]" : "/", "page");
  return {
    status: error ? "already-in-list" : "added",
    movieId,
    watched: vote?.watched ?? false,
    rating: (vote?.rating as Rating | null | undefined) ?? null,
    hype: (vote?.hype as Hype | null | undefined) ?? null,
  };
}

export async function addWatchedToList(
  externalId: string,
  listId?: string,
): Promise<AddToListResult> {
  const result = await addToList(externalId, listId);
  if (result.status === "error") return result;

  const markedWatched = await setWatched(result.movieId, true);
  if (!markedWatched) {
    return {
      status: "error",
      message: "Added to the list, but couldn't mark it watched.",
    };
  }

  return {
    ...result,
    watched: true,
    rating: null,
    hype: null,
  };
}

export async function removeFromList(
  movieId: string,
  listId?: string,
): Promise<boolean> {
  const supabase = await createClient();

  let targetListId = listId;
  if (!targetListId) {
    const { data: claims } = await getClaims(supabase);
    const userId = claims?.claims?.sub;
    if (typeof userId !== "string") return false;

    const { data: list } = await supabase
      .from("lists")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("is_default", true)
      .single();
    if (!list) return false;
    targetListId = list.id;
  }

  // .select() so a delete RLS filtered out reads as a failure, not a quiet
  // success: on a group list only the adder or the group's creator may remove
  // an item (20260924140000_public_launch_hardening.sql), and RLS answers
  // everyone else with zero rows rather than an error.
  const { data: deleted, error } = await supabase
    .from("list_items")
    .delete()
    .eq("list_id", targetListId)
    .eq("movie_id", movieId)
    .select("movie_id");
  if (error || !deleted || deleted.length === 0) return false;

  // "/groups/[id]" is the page-file form: it invalidates every path matching
  // that dynamic route. Targeting "/groups" with type "layout" would not work
  // -- "layout" matches a layout *file*, and there is no app/groups/layout.tsx.
  revalidatePath(listId ? "/groups/[id]" : "/", "page");
  return true;
}
