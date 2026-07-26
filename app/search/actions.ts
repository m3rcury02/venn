"use server";

import { provider, type MovieSummary } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

export type SearchResult = MovieSummary & { posterUrl: string | null };

// Anything shorter returns nothing rather than firing a TMDB call per keystroke.
const MIN_QUERY_LENGTH = 2;

export async function searchMovies(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("region")
    .single();

  const results = await provider.search(trimmed, profile?.region ?? "IN");

  return results.map((movie) => ({
    ...movie,
    posterUrl: movie.posterPath
      ? provider.getImageUrl(movie.posterPath, "w185")
      : null,
  }));
}
