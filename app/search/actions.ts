"use server";

import type { Hype, Rating } from "@/app/status/actions";
import { PROVIDER_NAME, provider, type MovieSummary } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

export type SearchResult = MovieSummary & {
  posterUrl: string | null;
  movieId: string | null;
  isInList: boolean;
  watched: boolean;
  rating: Rating | null;
  hype: Hype | null;
};

// Anything shorter returns nothing rather than firing a TMDB call per keystroke.
const MIN_QUERY_LENGTH = 2;

export async function searchMovies(query: string, listId?: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const supabase = await createClient();
  const [{ data: profile }, { data: claims }] = await Promise.all([
    supabase.from("profiles").select("region").single(),
    supabase.auth.getClaims(),
  ]);

  const results = await provider.search(trimmed, profile?.region ?? "IN");
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

  const movieIdByExternalId = new Map(
    (mappings ?? []).map((mapping) => [mapping.external_id, mapping.movie_id]),
  );
  const movieIds = [...movieIdByExternalId.values()];
  const userId = claims?.claims?.sub;

  let targetListId = listId;
  if (!targetListId && typeof userId === "string") {
    const { data: list } = await supabase
      .from("lists")
      .select("id")
      .eq("owner_user_id", userId)
      .eq("is_default", true)
      .single();
    targetListId = list?.id;
  }

  const [itemsResult, statusesResult] = await Promise.all([
    targetListId && movieIds.length > 0
      ? supabase
          .from("list_items")
          .select("movie_id")
          .eq("list_id", targetListId)
          .in("movie_id", movieIds)
      : Promise.resolve({ data: [], error: null }),
    typeof userId === "string" && movieIds.length > 0
      ? supabase
          .from("user_movie_status")
          .select("movie_id, watched, rating, hype")
          .eq("user_id", userId)
          .in("movie_id", movieIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (itemsResult.error) throw itemsResult.error;
  if (statusesResult.error) throw statusesResult.error;

  const listedMovieIds = new Set((itemsResult.data ?? []).map((item) => item.movie_id));
  const statusByMovieId = new Map(
    (statusesResult.data ?? []).map((status) => [status.movie_id, status]),
  );

  return results.map((movie) => {
    const movieId = movieIdByExternalId.get(movie.externalId) ?? null;
    const status = movieId ? statusByMovieId.get(movieId) : null;

    return {
      ...movie,
      posterUrl: movie.posterPath
        ? provider.getImageUrl(movie.posterPath, "w185")
        : null,
      movieId,
      isInList: movieId ? listedMovieIds.has(movieId) : false,
      watched: status?.watched ?? false,
      rating: (status?.rating as Rating | null | undefined) ?? null,
      hype: (status?.hype as Hype | null | undefined) ?? null,
    };
  });
}
