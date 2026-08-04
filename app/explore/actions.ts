"use server";

import { exploreFeed, type ExploreCard } from "@/lib/movies/explore";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

// The client never supplies a user or region -- both are resolved from the
// session here, so a forged call can only fetch the caller's own feed.
export async function loadExploreFeed(page: number): Promise<ExploreCard[]> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const supabase = await createClient();

  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return [];

  const { data: profile } = await supabase
    .from("profiles")
    .select("region")
    .eq("id", userId)
    .single();

  return exploreFeed(userId, profile?.region ?? "IN", safePage);
}

export async function registerExploreDisinterest(movieId: string): Promise<void> {
  if (typeof movieId !== "string" || !movieId) return;
  const supabase = await createClient();

  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return;

  const { data: existing } = await supabase
    .from("user_movie_status")
    .select("watched, rating, hype, scrolled_past_at")
    .eq("user_id", userId)
    .eq("movie_id", movieId)
    .maybeSingle();

  // If the user already has an active vote or hype status, leave it intact
  if (existing && (existing.watched || existing.rating !== null || existing.hype !== null)) {
    return;
  }

  await supabase.from("user_movie_status").upsert({
    user_id: userId,
    movie_id: movieId,
    watched: false,
    rating: null,
    scrolled_past_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}


