import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { ListFilter, matchesFilter, parseFilter, type Status } from "@/components/list-filter";
import { MovieCard } from "@/components/movie-card";
import { RemoveFromListButton } from "@/components/remove-from-list-button";
import { VennMark } from "@/components/venn-mark";
import { VoteControl } from "@/components/vote-control";
import { WatchedToggle } from "@/components/watched-toggle";
import { provider } from "@/lib/providers";
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
    user_movie_status: Status[];
  };
};

type HomeProps = {
  searchParams: Promise<{ filter?: string }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const supabase = await createClient();

  // getClaims() verifies the JWT signature; never trust getSession() here.
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  // Scoped to owner_user_id, not is_default alone: since phase 3 the lists
  // policy also returns group lists, and .single() would throw on two rows.
  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("owner_user_id", data.claims.sub)
    .eq("is_default", true)
    .single();

  const { data: rawItems } = list
    ? await supabase
        .from("list_items")
        .select(
          "movie_id, added_at, movies(title, year, poster_path, user_movie_status(watched, rating, hype))",
        )
        .eq("list_id", list.id)
        .order("added_at", { ascending: false })
    : { data: null };

  const items = rawItems as unknown as ListItemRow[] | null;
  const count = items?.length ?? 0;

  // head: true -- the badge needs the number, never the rows.
  const { count: pendingCount } = await supabase
    .from("ingest_inbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const filter = parseFilter((await searchParams).filter);
  const statuses = items?.map((item) => item.movies.user_movie_status[0] ?? null) ?? [];
  const filteredItems = items?.filter((_, i) => matchesFilter(filter, statuses[i])) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:px-8">
      <AppHeader
        subtitle={count > 0 ? `Your list · ${count} movie${count === 1 ? "" : "s"}` : "Your list"}
        inboxCount={pendingCount ?? 0}
        actions={
          <>
            <Link href="/groups" className={navLinkClass}>
              Groups
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

      {items && items.length > 0 ? (
        <>
          <ListFilter active={filter} statuses={statuses} />

          {filteredItems.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filteredItems.map((item, i) => {
                const status = item.movies.user_movie_status[0] ?? null;
                const watched = status?.watched ?? false;
                return (
                  <div
                    key={item.movie_id}
                    className="motion-safe:animate-rise-in"
                    style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                  >
                    <MovieCard
                      title={item.movies.title}
                      year={item.movies.year}
                      posterUrl={
                        item.movies.poster_path
                          ? provider.getImageUrl(item.movies.poster_path, "w185")
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
            <p className="py-16 text-center text-sm text-fg-muted">
              No movies match this filter.
            </p>
          )}
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24 text-center">
          <VennMark size={40} />
          <div className="space-y-1">
            <p className="text-lg font-medium text-fg">Nothing here yet</p>
            <p className="max-w-sm text-sm text-fg-muted">
              Search for a movie to add it — this is where your side of the
              overlap lives.
            </p>
          </div>
          <Link
            href="/search"
            className="mt-2 rounded-full bg-overlap px-5 py-2.5 text-sm font-medium text-overlap-fg transition-transform hover:scale-105"
          >
            Search movies
          </Link>
        </div>
      )}
    </main>
  );
}
