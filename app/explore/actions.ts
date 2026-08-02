"use server";

import { exploreFeed, type ExploreCard } from "@/lib/movies/explore";
import { createClient } from "@/lib/supabase/server";

// The client never supplies a user or region -- both are resolved from the
// session here, so a forged call can only fetch the caller's own feed.
export async function loadExploreFeed(page: number): Promise<ExploreCard[]> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") return [];

  const { data: profile } = await supabase
    .from("profiles")
    .select("region")
    .eq("id", userId)
    .single();

  return exploreFeed(userId, profile?.region ?? "IN", safePage);
}
