import { notFound, redirect } from "next/navigation";
import { cacheMovie } from "@/lib/movies/cache";

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

  const movieId = await cacheMovie(externalId);
  redirect(`/movies/${movieId}`);
}
