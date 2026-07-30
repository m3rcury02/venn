"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Rating } from "@/app/status/actions";
import { cacheMovie } from "@/lib/movies/cache";
import { PROVIDER_NAME, provider } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

export type OnboardingProfileState = { error?: string };

export type OnboardingMovie = {
  externalId: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  rating: Rating | null;
};

export type OnboardingRatingResult = {
  ok: boolean;
  count: number;
  message?: string;
};

async function authenticatedUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return typeof userId === "string" ? userId : null;
}

export async function saveOnboardingProfile(
  _previous: OnboardingProfileState,
  formData: FormData,
): Promise<OnboardingProfileState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const region = String(formData.get("region") ?? "").trim().toUpperCase();

  if (!/^[a-z0-9_]{3,30}$/.test(username)) {
    return {
      error: "Use 3–30 lowercase letters, numbers, or underscores.",
    };
  }
  if (!/^[A-Z]{2}$/.test(region)) {
    return { error: "Choose a country." };
  }

  const supabase = await createClient();
  const userId = await authenticatedUserId();
  if (!userId) return { error: "Not signed in." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .single();

  const changes: {
    username: string;
    region: string;
    display_name?: string;
  } = { username, region };
  if (!profile?.display_name?.trim()) changes.display_name = username;

  const { error } = await supabase
    .from("profiles")
    .update(changes)
    .eq("id", userId);

  if (error?.code === "23505") return { error: "That username is already taken." };
  if (error) return { error: "Couldn't save your profile." };

  revalidatePath("/onboarding");
  redirect("/onboarding");
}

export async function loadPopularOnboarding(
  page: number,
): Promise<OnboardingMovie[]> {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const supabase = await createClient();
  const userId = await authenticatedUserId();
  if (!userId) return [];

  const { data: profile } = await supabase
    .from("profiles")
    .select("region")
    .eq("id", userId)
    .single();

  const results = await provider.popular(profile?.region ?? "IN", safePage);
  if (results.length === 0) return [];

  const { data: mappings, error: mappingError } = await supabase
    .from("movie_external_ids")
    .select("external_id, movie_id")
    .eq("provider", PROVIDER_NAME)
    .in(
      "external_id",
      results.map((movie) => movie.externalId),
    );
  if (mappingError) throw mappingError;

  const byExternalId = new Map(
    (mappings ?? []).map((mapping) => [mapping.external_id, mapping.movie_id]),
  );
  const movieIds = [...byExternalId.values()];
  const { data: statuses, error: statusError } =
    movieIds.length > 0
      ? await supabase
          .from("user_movie_status")
          .select("movie_id, rating")
          .eq("user_id", userId)
          .in("movie_id", movieIds)
      : { data: [], error: null };
  if (statusError) throw statusError;

  const ratingByMovieId = new Map(
    (statuses ?? []).map((status) => [
      status.movie_id,
      (status.rating as Rating | null) ?? null,
    ]),
  );

  return results.map((movie) => {
    const movieId = byExternalId.get(movie.externalId);
    return {
      externalId: movie.externalId,
      title: movie.title,
      year: movie.year,
      posterUrl: movie.posterPath
        ? provider.getImageUrl(movie.posterPath, "w185")
        : null,
      rating: movieId ? (ratingByMovieId.get(movieId) ?? null) : null,
    };
  });
}

export async function rateOnboardingMovie(
  externalId: string,
  rating: Rating,
): Promise<OnboardingRatingResult> {
  if (!["hate", "like", "love"].includes(rating)) {
    return { ok: false, count: 0, message: "Choose a rating." };
  }

  const userId = await authenticatedUserId();
  if (!userId) return { ok: false, count: 0, message: "Not signed in." };

  let movieId: string;
  try {
    movieId = await cacheMovie(externalId);
  } catch {
    return { ok: false, count: 0, message: "Couldn't load that movie." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_movie_status").upsert({
    user_id: userId,
    movie_id: movieId,
    watched: true,
    rating,
    hype: null,
    // Onboarding captures historical taste, not a viewing date.
    watched_at: null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, count: 0, message: "Couldn't save that rating." };

  const { count } = await supabase
    .from("user_movie_status")
    .select("movie_id", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("rating", "is", null);

  return { ok: true, count: count ?? 0 };
}

export async function completeOnboarding(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_onboarding");
  if (error) return { error: "Rate ten movies before continuing." };

  revalidatePath("/", "layout");
  redirect("/");
}
