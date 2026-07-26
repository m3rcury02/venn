import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { MovieCard } from "@/components/movie-card";
import { RemoveFromListButton } from "@/components/remove-from-list-button";
import { VennMark } from "@/components/venn-mark";
import { provider } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

// No generated database.types.ts (see docs/DECISIONS.md phase 1a) -- postgrest-js
// can't infer that movies is a to-one embed without it, and types it as an array.
// It is a single object at runtime because list_items.movie_id -> movies.id is
// many-to-one from list_items' side.
type ListItemRow = {
  movie_id: string;
  movies: { title: string; year: number | null; poster_path: string | null };
};

export default async function Home() {
  const supabase = await createClient();

  // getClaims() verifies the JWT signature; never trust getSession() here.
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("is_default", true)
    .single();

  const { data: rawItems } = list
    ? await supabase
        .from("list_items")
        .select("movie_id, added_at, movies(title, year, poster_path)")
        .eq("list_id", list.id)
        .order("added_at", { ascending: false })
    : { data: null };

  const items = rawItems as unknown as ListItemRow[] | null;
  const count = items?.length ?? 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:px-8">
      <AppHeader
        subtitle={count > 0 ? `Your list · ${count} movie${count === 1 ? "" : "s"}` : "Your list"}
        actions={
          <>
            <Link href="/search" className={navLinkClass}>
              Search
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
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item, i) => (
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
              >
                <RemoveFromListButton movieId={item.movie_id} />
              </MovieCard>
            </div>
          ))}
        </div>
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
