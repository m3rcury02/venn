import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { MovieCard } from "@/components/movie-card";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { VennMark } from "@/components/venn-mark";
import { provider, type MediaType } from "@/lib/providers";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

type HypeHistoryRow = {
  movie_id: string;
  hype: "dont_care" | "hyped" | "superhyped";
  resolved_rating: "hate" | "like" | "love" | null;
};

type UserMovieStatusRow = {
  movie_id: string;
  watched: boolean;
  rating: "hate" | "like" | "love" | null;
};

type RecentWatchedRow = {
  movie_id: string;
  watched_at: string | null;
  rating: "hate" | "like" | "love" | null;
  movies: {
    title: string;
    year: number | null;
    poster_path: string | null;
    media_type: MediaType;
  } | null;
};

export default async function StatsPage() {
  const supabase = await createClient();

  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const [{ data: rawHistory }, { data: rawStatuses }, { data: rawRecent }] = await Promise.all([
    supabase
      .from("hype_history")
      .select("movie_id, hype, resolved_rating")
      .eq("user_id", userId),
    supabase
      .from("user_movie_status")
      .select("movie_id, watched, rating")
      .eq("user_id", userId),
    supabase
      .from("user_movie_status")
      .select("movie_id, watched_at, rating, movies(title, year, poster_path, media_type)")
      .eq("user_id", userId)
      .eq("watched", true)
      .order("watched_at", { ascending: false, nullsFirst: false })
      .limit(12),
  ]);

  const history = (rawHistory ?? []) as HypeHistoryRow[];
  const statuses = (rawStatuses ?? []) as UserMovieStatusRow[];
  const recent = (rawRecent ?? []) as unknown as RecentWatchedRow[];

  const watchedStatuses = statuses.filter((s) => s.watched);
  const totalWatched = watchedStatuses.length;
  const loveCount = watchedStatuses.filter((s) => s.rating === "love").length;
  const likeCount = watchedStatuses.filter((s) => s.rating === "like").length;
  const hateCount = watchedStatuses.filter((s) => s.rating === "hate").length;
  const unratedCount = watchedStatuses.filter((s) => s.rating === null).length;

  const totalRated = loveCount + likeCount + hateCount;
  const lovePct = totalRated > 0 ? Math.round((loveCount / totalRated) * 100) : 0;
  const likePct = totalRated > 0 ? Math.round((likeCount / totalRated) * 100) : 0;
  const hatePct = totalRated > 0 ? Math.round((hateCount / totalRated) * 100) : 0;

  const hypeLevels: Array<"superhyped" | "hyped" | "dont_care"> = [
    "superhyped",
    "hyped",
    "dont_care",
  ];

  const hypeLabels: Record<"superhyped" | "hyped" | "dont_care", string> = {
    superhyped: "Superhyped",
    hyped: "Hyped",
    dont_care: "Don't care",
  };

  let headlineSentence: string | null = null;
  for (const level of hypeLevels) {
    const resolvedForLevel = history.filter(
      (h) => h.hype === level && h.resolved_rating !== null,
    );
    if (resolvedForLevel.length > 0) {
      const lovedForLevel = resolvedForLevel.filter((h) => h.resolved_rating === "love").length;
      headlineSentence = `You loved ${lovedForLevel} of the ${resolvedForLevel.length} titles you were ${
        level === "superhyped" ? "superhyped" : level === "hyped" ? "hyped" : "indifferent"
      } for.`;
      break;
    }
  }

  const pendingHistory = history.filter((h) => h.resolved_rating === null);
  const statusMap = new Map(statuses.map((s) => [s.movie_id, s]));

  const openHavenWatchedCount = pendingHistory.filter((h) => {
    const st = statusMap.get(h.movie_id);
    return !st?.watched;
  }).length;

  const openWatchedNotRatedCount = pendingHistory.filter((h) => {
    const st = statusMap.get(h.movie_id);
    return st?.watched && !st.rating;
  }).length;

  if (history.length === 0 && totalWatched === 0) {
    return (
      <Screen>
        <AppHeader
          subtitle="Stats"
          actions={
            <>
              <Link href="/" className={navLinkClass}>
                My list
              </Link>
              <Link href="/discover" className={navLinkClass}>
                Discover
              </Link>
            </>
          }
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-24 text-center">
          <VennMark size={44} />
          <h1 className="t-section text-3xl text-fg">No stats yet</h1>
          <p className="t-body max-w-sm text-[15px] text-fg-dim">
            Hype votes on unwatched titles measure how well your expectations match reality over time.
          </p>
          <Link href="/search" className={buttonClass("marquee", "mt-2")}>
            Search movies & shows
          </Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader
        subtitle="Stats"
        actions={
          <>
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
            <Link href="/discover" className={navLinkClass}>
              Discover
            </Link>
          </>
        }
      />

      <h1 className="t-display text-[clamp(44px,13vw,96px)] text-fg">Stats</h1>

      {/* 1. Watch history */}
      <section className="flex flex-col gap-6">
        <h2 className="t-label text-fg-faint">Watch history</h2>

        <Panel className="flex flex-col gap-6">
          <div>
            <span className="font-display text-4xl font-semibold text-fg">{totalWatched}</span>
            <span className="t-label ml-2 text-fg-dim">titles watched</span>
          </div>

          {totalRated > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex h-4 w-full overflow-hidden rounded-ctl bg-surface-2">
                {lovePct > 0 ? (
                  <div
                    style={{ width: `${lovePct}%` }}
                    className="bg-beam-a transition-all"
                    title={`Loved: ${loveCount} (${lovePct}%)`}
                  />
                ) : null}
                {likePct > 0 ? (
                  <div
                    style={{ width: `${likePct}%` }}
                    className="bg-fg-dim transition-all"
                    title={`Liked: ${likeCount} (${likePct}%)`}
                  />
                ) : null}
                {hatePct > 0 ? (
                  <div
                    style={{ width: `${hatePct}%` }}
                    className="bg-beam-b transition-all"
                    title={`Hated: ${hateCount} (${hatePct}%)`}
                  />
                ) : null}
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 t-label text-fg-dim">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-beam-a" />
                  Loved: {loveCount} ({lovePct}%)
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-fg-dim" />
                  Liked: {likeCount} ({likePct}%)
                </span>
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-beam-b" />
                  Hated: {hateCount} ({hatePct}%)
                </span>
              </div>
            </div>
          ) : null}

          {unratedCount > 0 ? (
            <p className="t-body text-[14px] text-fg-dim">
              {unratedCount} watched title{unratedCount === 1 ? "" : "s"} not rated yet.
            </p>
          ) : null}
        </Panel>

        {recent.length > 0 ? (
          <div className="flex flex-col gap-4">
            <h3 className="t-label text-fg-faint">Recently watched</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {recent.map((r) => {
                if (!r.movies) return null;
                return (
                  <MovieCard
                    key={r.movie_id}
                    title={r.movies.title}
                    year={r.movies.year}
                    mediaType={r.movies.media_type}
                    href={`/movies/${r.movie_id}`}
                    posterUrl={
                      r.movies.poster_path
                        ? provider.getImageUrl(r.movies.poster_path, "w342")
                        : null
                    }
                  />
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      {/* 2. Hype vs reality */}
      <section className="flex flex-col gap-6">
        <div>
          <h2 className="t-label text-fg-faint">Hype vs reality</h2>
          {headlineSentence ? (
            <p className="t-body mt-2 text-lg text-fg">{headlineSentence}</p>
          ) : null}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {hypeLevels.map((level) => {
            const resolved = history.filter(
              (h) => h.hype === level && h.resolved_rating !== null,
            );
            const total = resolved.length;
            const loved = resolved.filter((h) => h.resolved_rating === "love").length;
            const liked = resolved.filter((h) => h.resolved_rating === "like").length;
            const hated = resolved.filter((h) => h.resolved_rating === "hate").length;

            return (
              <Panel key={level} className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="font-display text-lg font-medium text-fg">
                    {hypeLabels[level]}
                  </span>
                  <span className="t-label text-fg-faint">
                    {total} resolved
                  </span>
                </div>

                {total === 0 ? (
                  <p className="t-body text-[14px] text-fg-faint">
                    Nothing resolved yet — rate something you were hyped for.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 t-body text-[14px] text-fg-dim">
                    <div className="flex justify-between">
                      <span>Loved</span>
                      <span className="text-fg font-medium">{loved}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Liked</span>
                      <span className="text-fg font-medium">{liked}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Hated</span>
                      <span className="text-fg font-medium">{hated}</span>
                    </div>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      </section>

      {/* 3. Still open */}
      <section className="flex flex-col gap-4">
        <h2 className="t-label text-fg-faint">Still open</h2>

        <Panel className="flex flex-col gap-3">
          <p className="t-body text-fg">
            {openHavenWatchedCount} title{openHavenWatchedCount === 1 ? "" : "s"} you haven&rsquo;t watched yet.
          </p>
          {openWatchedNotRatedCount > 0 ? (
            <p className="t-body text-fg-dim flex items-center gap-2">
              <span>
                {openWatchedNotRatedCount} title{openWatchedNotRatedCount === 1 ? "" : "s"} you&rsquo;ve watched but not rated.
              </span>
              <Link href="/" className="underline hover:text-fg">
                Rate on My List &rarr;
              </Link>
            </p>
          ) : null}
        </Panel>
      </section>
    </Screen>
  );
}
