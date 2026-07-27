import { notFound, redirect } from "next/navigation";
import { cacheMovie } from "@/lib/movies/cache";

type ExternalMoviePageProps = {
  params: Promise<{ externalId: string }>;
};

export default async function ExternalMoviePage({
  params,
}: ExternalMoviePageProps) {
  const { externalId } = await params;

  // The active provider is TMDB, whose movie ids are positive integers. Keep
  // arbitrary strings out of the provider path; a future provider can revise
  // this resolver without changing canonical internal movie URLs.
  if (!/^[1-9]\d*$/.test(externalId)) notFound();

  const movieId = await cacheMovie(externalId);
  redirect(`/movies/${movieId}`);
}
