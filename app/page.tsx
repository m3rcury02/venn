import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { ListFilter, matchesFilter, parseFilter, type Status } from "@/components/list-filter";
import { MovieCard } from "@/components/movie-card";
import { RemoveFromListButton } from "@/components/remove-from-list-button";
import { buttonClass } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { VennMark } from "@/components/venn-mark";
import { VoteControl } from "@/components/vote-control";
import { WatchConfirmations, type PendingConfirmation } from "@/components/watch-confirmations";
import { WatchedToggle } from "@/components/watched-toggle";
import { provider, type MediaType } from "@/lib/providers";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

// No generated database.types.ts (see docs/DECISIONS.md phase 1a) -- postgrest-js
// can't infer that movies is a to-one embed without it, and types it as an array.
// It is a single object at runtime because list_items.movie_id -> movies.id is
// many-to-one from list_items' side. user_movie_status is genuinely to-many
// from movies' side (0 or 1 row per caller, RLS-scoped), so that embed's array
// type is correct as-is.
type ListItemRow = {
  movie_id: string;
  movies: {
    title: string;
    year: number | null;
    poster_path: string | null;
    media_type: MediaType;
    user_movie_status: Status[];
  };
};

type HomeProps = {
  searchParams: Promise<{ filter?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const supabase = await createClient();

  // getClaims() verifies the JWT signature; never trust getSession() here.
  const { data } = await getClaims(supabase);
  if (!data?.claims) redirect("/login");

  // list and the inbox badge count are independent reads, run together rather
  // than serially -- only list_items below actually depends on list.
  const [{ data: list }, { count: pendingCount }, { data: rawConfirmations }] =
    await Promise.all([
      // Scoped to owner_user_id, not is_default alone: since phase 3 the lists
      // policy also returns group lists, and .single() would throw on two rows.
      supabase
        .from("lists")
        .select("id")
        .eq("owner_user_id", data.claims.sub)
        .eq("is_default", true)
        .single(),
      // head: true -- the badge needs the number, never the rows.
      supabase
        .from("ingest_inbox")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending"),
      supabase
        .from("watch_confirmations")
        .select("movie_night_id, movie_nights(picked_movie_id, movies(title), groups(name))")
        .eq("user_id", data.claims.sub)
        .eq("status", "pending"),
    ]);

  const { data: rawItems } = list
    ? await supabase
        .from("list_items")
        .select(
          "movie_id, added_at, movies(title, year, poster_path, media_type, user_movie_status(watched, rating, hype))",
        )
        .eq("list_id", list.id)
        .order("added_at", { ascending: false })
    : { data: null };

  const items = rawItems as unknown as ListItemRow[] | null;
  const count = items?.length ?? 0;

  const filter = parseFilter((await searchParams).filter);
  const statuses = items?.map((item) => item.movies.user_movie_status[0] ?? null) ?? [];
  const filteredItems = items?.filter((_, i) => matchesFilter(filter, statuses[i])) ?? [];
  const unwatched = statuses.filter((s) => !(s?.watched ?? false)).length;

  type ConfirmationQueryRow = {
    movie_night_id: string;
    movie_nights: {
      movies: { title: string } | null;
      groups: { name: string } | null;
    } | null;
  };

  const pendingConfirmations: PendingConfirmation[] =
    ((rawConfirmations as unknown as ConfirmationQueryRow[]) ?? [])
      .filter((r) => r.movie_nights?.movies?.title && r.movie_nights?.groups?.name)
      .map((r) => ({
        nightId: r.movie_night_id,
        movieTitle: r.movie_nights!.movies!.title,
        groupName: r.movie_nights!.groups!.name,
      }));

  return (
    <Screen>
      <AppHeader
        subtitle="Your list"
        inboxCount={pendingCount ?? 0}
        actions={
          <>
            <Link href="/groups" className={navLinkClass}>
              Groups
            </Link>
            <Link href="/discover" className={navLinkClass}>
              Discover
            </Link>
            <Link href="/explore" className={navLinkClass}>
              Explore
            </Link>
            <Link href="/search" className={navLinkClass}>
              Search
            </Link>
            <Link href="/settings" className={navLinkClass}>
              Settings
            </Link>
            <form action="/auth/signout" method="post">
              <button type="submit" className={navLinkClass}>
                Sign out
              </button>
            </form>
          </>
        }
      />

      <WatchConfirmations confirmations={pendingConfirmations} />

      {items && items.length > 0 ? (
        <>
          <div>
            <h1 className="t-display text-[clamp(44px,13vw,104px)] text-fg">Your list</h1>
            <p className="t-label mt-4 text-fg-dim">
              {count} title{count === 1 ? "" : "s"} · {unwatched} unwatched
            </p>
          </div>

          <ListFilter active={filter} statuses={statuses} />

          {filteredItems.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filteredItems.map((item, i) => {
                const status = item.movies.user_movie_status[0] ?? null;
                const watched = status?.watched ?? false;
                return (
                  <div
                    key={item.movie_id}
                    className="motion-safe:animate-expose"
                    style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  >
                    <MovieCard
                      title={item.movies.title}
                      year={item.movies.year}
                      mediaType={item.movies.media_type}
                      href={`/movies/${item.movie_id}`}
                      posterUrl={
                        item.movies.poster_path
                          ? provider.getImageUrl(item.movies.poster_path, "w342")
                          : null
                      }
                      footer={
                        <VoteControl
                          movieId={item.movie_id}
                          watched={watched}
                          rating={status?.rating ?? null}
                          hype={status?.hype ?? null}
                        />
                      }
                    >
                      <div className="flex gap-1">
                        <WatchedToggle movieId={item.movie_id} watched={watched} />
                        <RemoveFromListButton movieId={item.movie_id} />
                      </div>
                    </MovieCard>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5 py-20 text-center">
              <p className="t-section text-3xl text-fg">Nothing under this filter</p>
              <p className="t-body max-w-sm text-[15px] text-fg-dim">
                Nothing on your list matches it yet.
              </p>
              <Link href="/" className={buttonClass("ghost")}>
                Show everything
              </Link>
            </div>
          )}
        </>
      ) : (
        <div className="relative flex flex-1 flex-col items-center justify-center gap-6 py-24 text-center">
          {/* Ambient beam wash behind the mark -- the only place on this screen
              the beams appear at size. */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-1/2 -z-10 h-64 w-64 -translate-x-1/2 -translate-y-[70%] opacity-40 blur-3xl"
            style={{
              background:
                "radial-gradient(circle at 32% 50%, var(--beam-a), transparent 60%), radial-gradient(circle at 68% 50%, var(--beam-b), transparent 60%)",
            }}
          />
          <VennMark size={96} mode="arrive" />
          <h1 className="t-display text-[clamp(44px,13vw,96px)] text-fg">
            Nothing here yet
          </h1>
          <p className="t-body max-w-sm text-[15px] text-fg-dim">
            Search for a movie or show to add it — this is where your side of
            the overlap lives.
          </p>
          <Link href="/search" className={buttonClass("marquee", "mt-2")}>
            Search movies & shows
          </Link>
        </div>
      )}
    </Screen>
  );
}
