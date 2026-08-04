"use server";

import { revalidatePath } from "next/cache";
import { captureServer } from "@/lib/analytics/server";
import { sendPush } from "@/lib/notifications/send";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type Rating = "hate" | "like" | "love";
export type Hype = "dont_care" | "hyped" | "superhyped";

async function getUserId() {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  return typeof userId === "string" ? userId : null;
}

// Flipping `watched` clears both vote columns rather than preserving whichever
// one the constraint doesn't need cleared: keeping a stale rating (or hype)
// across the flip would show a vote for a state the user just said isn't true
// anymore. This is an upsert -- a movie can be marked watched before any hype
// vote ever created the row.
export async function setWatched(movieId: string, watched: boolean): Promise<boolean> {
  const userId = await getUserId();
  if (!userId) return false;

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase.from("user_movie_status").upsert({
    user_id: userId,
    movie_id: movieId,
    watched,
    watched_at: watched ? now : null,
    rating: null,
    hype: null,
    updated_at: now,
  });
  if (error) return false;

  // Flipping watched clears `rating`, so it changes the caller's tag weights
  // just as setRating does (SPEC §4.1: "rebuilt when a user's rating changes").
  const { error: rebuildError } = await supabase.rpc("rebuild_user_tag_weights");

  if (!rebuildError) {
    captureServer(userId, "vote_cast", { kind: "watched" });

    if (watched) {
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: nights } = await supabase
          .from("movie_nights")
          .select("id, movie_night_attendees!inner(user_id)")
          .eq("picked_movie_id", movieId)
          .eq("movie_night_attendees.user_id", userId)
          .gte("held_at", thirtyDaysAgo);

        if (nights && nights.length > 0) {
          const { data: movie } = await supabase
            .from("movies")
            .select("title")
            .eq("id", movieId)
            .maybeSingle();
          const movieTitle = movie?.title || "a movie";

          for (const night of nights) {
            await supabase.rpc("request_watch_confirmations", { p_night_id: night.id });

            const { data: attendees } = await supabase
              .from("movie_night_attendees")
              .select("user_id")
              .eq("movie_night_id", night.id);

            if (attendees) {
              for (const att of attendees) {
                if (att.user_id !== userId) {
                  sendPush(att.user_id, "watch_confirmation", {
                    title: "Did you watch?",
                    body: `Confirm whether you watched ${movieTitle}`,
                    url: "/",
                  });
                }
              }
            }
          }
        }
      } catch {
        // Confirmation requests are strictly additive and must never fail setWatched
      }
    }
  }

  revalidatePath("/");
  return !rebuildError;
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

  // SPEC §4.1: tag weights are rebuilt when a rating changes. The RPC is a
  // no-argument SECURITY DEFINER function that reads auth.uid() itself, so the
  // only weights it can touch are the caller's.
  await supabase.rpc("rebuild_user_tag_weights");

  captureServer(userId, "vote_cast", { kind: "rating" });

  revalidatePath("/");
}

// Upsert: unwatched-with-no-vote is the implicit default for every movie in
// the catalog, so a hype vote is what creates the row for a movie nobody has
// marked watched yet. `hype: null` clears the vote, same reasoning as above.
//
// No tag-weight rebuild here, unlike the two above: §4.1 builds weights from
// ratings only. Hype is not an input to them -- it enters the recommender later
// and more directly, by overriding taste outright (§4.3 step 3).
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

  captureServer(userId, "vote_cast", { kind: "hype" });

  revalidatePath("/");
}
