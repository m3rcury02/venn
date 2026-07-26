"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type Rating = "hate" | "like" | "love";
export type Hype = "dont_care" | "hyped" | "superhyped";

async function getUserId() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  return typeof userId === "string" ? userId : null;
}

// Flipping `watched` clears both vote columns rather than preserving whichever
// one the constraint doesn't need cleared: keeping a stale rating (or hype)
// across the flip would show a vote for a state the user just said isn't true
// anymore. This is an upsert -- a movie can be marked watched before any hype
// vote ever created the row.
export async function setWatched(movieId: string, watched: boolean): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const supabase = await createClient();
  const now = new Date().toISOString();

  await supabase.from("user_movie_status").upsert({
    user_id: userId,
    movie_id: movieId,
    watched,
    watched_at: watched ? now : null,
    rating: null,
    hype: null,
    updated_at: now,
  });

  revalidatePath("/");
}

// UPDATE, not upsert: a rating can only exist on a row setWatched(true) already
// created, so there is never a row to create here. `rating: null` clears the
// vote -- clicking the selected choice again deselects it (SPEC §8: the vote is
// prompted, never blocking, so "no vote" has to stay reachable).
export async function setRating(movieId: string, rating: Rating | null): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const supabase = await createClient();

  await supabase
    .from("user_movie_status")
    .update({ rating, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("movie_id", movieId);

  revalidatePath("/");
}

// Upsert: unwatched-with-no-vote is the implicit default for every movie in
// the catalog, so a hype vote is what creates the row for a movie nobody has
// marked watched yet. `hype: null` clears the vote, same reasoning as above.
export async function setHype(movieId: string, hype: Hype | null): Promise<void> {
  const userId = await getUserId();
  if (!userId) return;

  const supabase = await createClient();

  await supabase.from("user_movie_status").upsert({
    user_id: userId,
    movie_id: movieId,
    watched: false,
    hype,
    rating: null,
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/");
}
