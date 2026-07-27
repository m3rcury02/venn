import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Hype, Rating } from "@/app/status/actions";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { MovieDetailStatus } from "@/components/movie-detail-status";
import { Poster } from "@/components/poster";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import {
  PROVIDER_NAME,
  provider,
  type MediaType,
  type WatchAvailability,
  type WatchProvider,
  type WatchProviderType,
} from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

type MovieDetailRow = {
  id: string;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  runtime: number | null;
  overview: string | null;
  rating_external: number | null;
  release_date: string | null;
  media_type: MediaType;
  user_movie_status: {
    watched: boolean;
    rating: Rating | null;
    hype: Hype | null;
  }[];
};

type MovieDetailPageProps = {
  params: Promise<{ id: string }>;
};

const WATCH_SECTIONS: {
  type: WatchProviderType;
  title: string;
}[] = [
  { type: "flatrate", title: "Stream" },
  { type: "rent", title: "Rent" },
  { type: "buy", title: "Buy" },
];

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function externalSearchQuery(movie: MovieDetailRow) {
  return `${movie.title}${movie.year ? ` ${movie.year}` : ""}`;
}

function letterboxdSearchUrl(query: string) {
  return `https://letterboxd.com/search/films/${encodeURIComponent(query)}/`;
}

function rottenTomatoesSearchUrl(query: string) {
  return `https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`;
}

function formatRuntime(minutes: number | null) {
  if (minutes === null) return null;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatReleaseDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function ProviderList({ providers }: { providers: WatchProvider[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {providers.map((watchProvider) => (
        <li
          key={`${watchProvider.type}:${watchProvider.name}`}
          className="flex min-h-14 items-center gap-3 rounded-ctl border border-hairline bg-surface-2 px-3 py-2"
        >
          {watchProvider.logoPath ? (
            // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
            <img
              src={provider.getImageUrl(watchProvider.logoPath, "w92")}
              alt=""
              className="h-8 w-8 shrink-0 rounded-ctl object-cover"
            />
          ) : null}
          <span className="t-body text-[13px] text-fg">{watchProvider.name}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function MovieDetailPage({ params }: MovieDetailPageProps) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const [movieResult, profileResult, mappingResult] = await Promise.all([
    supabase
      .from("movies")
      .select(
        "id, title, original_title, year, poster_path, backdrop_path, runtime, overview, rating_external, release_date, media_type, user_movie_status(watched, rating, hype)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("profiles").select("region").eq("id", userId).maybeSingle(),
    supabase
      .from("movie_external_ids")
      .select("external_id")
      .eq("movie_id", id)
      .eq("provider", PROVIDER_NAME)
      .maybeSingle(),
  ]);

  if (movieResult.error) throw movieResult.error;
  if (profileResult.error) throw profileResult.error;
  if (mappingResult.error) throw mappingResult.error;
  if (!movieResult.data) notFound();

  const movie = movieResult.data as unknown as MovieDetailRow;
  const region = profileResult.data?.region ?? "IN";
  const externalId = mappingResult.data?.external_id ?? null;

  let availability: WatchAvailability | null = null;
  let availabilityFailed = false;
  let imdbId: string | null = null;

  if (externalId) {
    const [watchResult, idsResult] = await Promise.allSettled([
      provider.getWatchProviders(externalId, region),
      provider.getExternalIds(externalId),
    ]);

    if (watchResult.status === "fulfilled") {
      availability = watchResult.value;
    } else {
      availabilityFailed = true;
      console.error("[venn] watch availability failed", watchResult.reason);
    }

    if (idsResult.status === "fulfilled") {
      imdbId = idsResult.value.imdbId;
    } else {
      console.error("[venn] external ids failed", idsResult.reason);
    }
  }

  const status = movie.user_movie_status[0] ?? null;
  const query = externalSearchQuery(movie);
  const runtime = formatRuntime(movie.runtime);
  const metadata = [
    formatReleaseDate(movie.release_date) ?? (movie.year ? String(movie.year) : null),
    runtime,
  ].filter((value): value is string => value !== null);
  const watchSections = WATCH_SECTIONS.map((section) => ({
    ...section,
    providers:
      availability?.providers.filter(
        (watchProvider) => watchProvider.type === section.type,
      ) ?? [],
  })).filter((section) => section.providers.length > 0);

  const posterUrl = movie.poster_path
    ? provider.getImageUrl(movie.poster_path, "w500")
    : null;
  const backdropUrl = movie.backdrop_path
    ? provider.getImageUrl(movie.backdrop_path, "w1280")
    : null;

  return (
    <Screen>
      <AppHeader
        subtitle={movie.media_type === "tv" ? "Show details" : "Movie details"}
        actions={
          <>
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
            <Link href="/search" className={navLinkClass}>
              Search
            </Link>
            <Link href="/groups" className={navLinkClass}>
              Groups
            </Link>
          </>
        }
      />

      <section className="relative overflow-hidden rounded-card border border-hairline">
        {backdropUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
          <img
            src={backdropUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-105 object-cover opacity-55 blur-sm saturate-[1.6]"
          />
        ) : null}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-r from-ink via-ink/90 to-ink/45"
        />

        <div className="relative grid gap-7 p-5 sm:grid-cols-[minmax(180px,260px)_1fr] sm:items-end sm:p-8">
          <Poster
            src={posterUrl}
            alt={movie.title}
            glow={false}
            markSize={44}
            className="w-full max-w-[260px]"
          />

          <div className="min-w-0">
            <h1 className="t-display text-[clamp(44px,11vw,96px)] text-fg">
              {movie.title}
            </h1>
            {metadata.length > 0 ? (
              <p className="t-label mt-5 text-fg">{metadata.join(" · ")}</p>
            ) : null}
            {movie.original_title && movie.original_title !== movie.title ? (
              <p className="t-body mt-3 text-[14px] text-fg-dim">
                Original title: {movie.original_title}
              </p>
            ) : null}
          </div>
        </div>
        <div className="grain-art" aria-hidden />
      </section>

      <div className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="t-label text-fg-faint">Synopsis</h2>
            <p className="t-body mt-4 max-w-3xl text-[17px] leading-7 text-fg-dim">
              {movie.overview ??
                `No synopsis is available for this ${movie.media_type === "tv" ? "show" : "movie"}.`}
            </p>
          </section>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="t-section text-3xl text-fg">Where to watch</h2>
                <p className="t-label mt-2 text-fg-faint">Region · {region}</p>
              </div>
              {availability?.link ? (
                <a
                  href={availability.link}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClass("ghost")}
                >
                  See current options
                </a>
              ) : null}
            </div>

            {availabilityFailed || !externalId ? (
              <Panel className="mt-5">
                <p className="t-body text-[14px] text-fg-dim">
                  {availabilityFailed
                    ? "Viewing availability is temporarily unavailable."
                    : `Viewing availability is not available for this ${movie.media_type === "tv" ? "show" : "movie"}.`}
                </p>
              </Panel>
            ) : watchSections.length > 0 ? (
              <div className="mt-5 flex flex-col gap-6">
                {watchSections.map((section) => (
                  <div key={section.type}>
                    <h3 className="t-label mb-3 text-fg-faint">{section.title}</h3>
                    <ProviderList providers={section.providers} />
                  </div>
                ))}
              </div>
            ) : (
              <Panel className="mt-5">
                <p className="t-body text-[14px] text-fg-dim">
                  No streaming, rental, or purchase options were found for {region}.
                </p>
              </Panel>
            )}

            <p className="t-body mt-4 text-[12px] text-fg-faint">
              Availability data by JustWatch via{" "}
              <a
                href="https://www.themoviedb.org"
                target="_blank"
                rel="noreferrer"
                className="text-fg-dim underline underline-offset-2 hover:text-fg"
              >
                TMDB
              </a>
              . Provider availability changes frequently.
            </p>
          </section>
        </div>

        <aside className="flex flex-col gap-5">
          <Panel>
            <h2 className="t-label text-fg-faint">Rating</h2>
            <p className="t-data mt-3 text-4xl text-marquee">
              {movie.rating_external !== null
                ? `${Number(movie.rating_external).toFixed(1)}/10`
                : "—"}
            </p>
            <dl className="mt-5 flex flex-col divide-y divide-hairline border-t border-hairline">
              {imdbId ? (
                <ExternalRatingLink
                  label="IMDb"
                  href={`https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`}
                />
              ) : null}
              {/* Letterboxd and Rotten Tomatoes' search links are film-only:
                  Letterboxd has no TV catalog at all, and neither site is worth
                  wiring in for shows without a real identifier. */}
              {movie.media_type === "movie" ? (
                <>
                  <ExternalRatingLink
                    label="Letterboxd"
                    href={letterboxdSearchUrl(query)}
                  />
                  <ExternalRatingLink
                    label="Rotten Tomatoes"
                    href={rottenTomatoesSearchUrl(query)}
                  />
                </>
              ) : null}
            </dl>
          </Panel>

          <Panel>
            <MovieDetailStatus
              movieId={movie.id}
              initialWatched={status?.watched ?? false}
              initialRating={status?.rating ?? null}
              initialHype={status?.hype ?? null}
            />
          </Panel>
        </aside>
      </div>
    </Screen>
  );
}

function ExternalRatingLink({ label, href }: { label: string; href: string }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 py-3">
      <dt className="t-body text-[14px] text-fg">{label}</dt>
      <dd>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="t-label text-beam-b transition-colors hover:text-fg"
        >
          View rating ↗
        </a>
      </dd>
    </div>
  );
}
