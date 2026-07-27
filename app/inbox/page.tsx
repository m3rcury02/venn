import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { InboxItem, type InboxCandidate } from "@/components/inbox-item";
import { buttonClass } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { VennMark } from "@/components/venn-mark";
import { extractCandidates } from "@/lib/ingest/extract";
import { provider } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

// SPEC §7 screen 5. Everything here reads local rows: /api/ingest already
// cached each candidate, so rendering this page costs zero provider calls even
// though every card has a poster.
type InboxRow = {
  id: string;
  raw_text: string;
  source: string;
  candidate_movie_ids: string[];
};

type MovieRow = {
  id: string;
  title: string;
  year: number | null;
  poster_path: string | null;
};

export default async function InboxPage() {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  const { data: rawItems } = await supabase
    .from("ingest_inbox")
    .select("id, raw_text, source, candidate_movie_ids")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const items = (rawItems as InboxRow[] | null) ?? [];

  // candidate_movie_ids is a uuid[], so there is no PostgREST embed to hang the
  // movies off -- arrays are not foreign keys. One batched select for every
  // candidate across every row instead of a join per item.
  const movieIds = [...new Set(items.flatMap((item) => item.candidate_movie_ids))];

  const { data: rawMovies } = movieIds.length
    ? await supabase
        .from("movies")
        .select("id, title, year, poster_path")
        .in("id", movieIds)
    : { data: null };

  const movies = new Map(
    ((rawMovies as MovieRow[] | null) ?? []).map((movie) => [movie.id, movie]),
  );

  return (
    <Screen width="narrow">
      <AppHeader
        subtitle={items.length > 0 ? `${items.length} waiting` : "Inbox"}
        actions={
          <>
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
            <Link href="/settings" className={navLinkClass}>
              Settings
            </Link>
          </>
        }
      />

      <h1 className="t-display text-[clamp(44px,13vw,96px)] text-fg">Inbox</h1>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((item, i) => {
            const candidates: InboxCandidate[] = item.candidate_movie_ids
              // A candidate whose movie row is gone (cascade from a delete)
              // simply does not render -- see the migration on why there is no
              // FK across an array.
              .map((id) => movies.get(id))
              .filter((movie): movie is MovieRow => movie !== undefined)
              .map((movie) => ({
                id: movie.id,
                title: movie.title,
                year: movie.year,
                posterUrl: movie.poster_path
                  ? provider.getImageUrl(movie.poster_path, "w185")
                  : null,
              }));

            // For the no-candidate case: hand the search box the best guess the
            // extractor already made -- and nothing at all when there is none.
            // The raw share is not a usable fallback: it is typically a caption
            // with a url in it, which searches to zero results and has to be
            // cleared before the user can type.
            const guess = extractCandidates(item.raw_text).find(
              (candidate) => candidate.kind === "query",
            );

            return (
              <div
                key={item.id}
                className="motion-safe:animate-expose"
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <InboxItem
                  id={item.id}
                  rawText={item.raw_text}
                  source={item.source}
                  candidates={candidates}
                  searchQuery={guess?.value}
                />
              </div>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-24 text-center">
          <VennMark size={44} />
          <p className="t-section text-3xl text-fg">Nothing waiting</p>
          <p className="t-body max-w-sm text-[15px] text-fg-dim">
            Anything you share to Venn that it can&rsquo;t place with certainty
            waits here. Set up a token in Settings to start sending things in.
          </p>
          <Link href="/settings" className={buttonClass("marquee", "mt-2")}>
            Settings
          </Link>
        </div>
      )}
    </Screen>
  );
}
