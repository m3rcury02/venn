import { notFound, redirect } from "next/navigation";
import { cacheMovieForUser } from "@/lib/movies/cache";
import { createClient } from "@/lib/supabase/server";

type ExternalMoviePageProps = {
  params: Promise<{ externalId: string }>;
};

export default async function ExternalMoviePage({
  params,
}: ExternalMoviePageProps) {
  const { externalId } = await params;

  // The active provider is TMDB, whose ids are "movie-<n>" or "tv-<n>" (see
  // lib/providers/tmdb.ts) -- a hyphen, not a colon: a colon arrives from
  // Next's dynamic route params percent-encoded and undecoded, which never
  // matches. Keep arbitrary strings out of the provider path; a future
  // provider can revise this resolver without changing canonical internal
  // movie URLs.
  if (!/^(movie|tv)-[1-9]\d*$/.test(externalId)) notFound();

  // Any "movie-<n>" in the URL is a fresh TMDB fetch the first time, so this
  // page is counted like any other uncached-title path. Past the limit it
  // throws, and app/error.tsx renders the retry screen.
  const movieId = await cacheMovieForUser(await createClient(), externalId);
  redirect(`/movies/${movieId}`);
}
