import Link from "next/link";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { ExploreFeed } from "@/components/explore-feed";
import { exploreFeed } from "@/lib/movies/explore";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { VennMark } from "@/components/venn-mark";

// The Explore trailer feed (post-phase-9 feature). Distinct from SPEC §7's
// screen 9 "Discover" -- that is the phase-10 people directory (search users,
// browse public lists and groups), which lives in a different feature.
export default async function ExplorePage() {
  const supabase = await createClient();

  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  const { data: profile } =
    typeof userId === "string"
      ? await supabase
          .from("profiles")
          .select("region")
          .eq("id", userId)
          .single()
      : { data: null };

  const region = profile?.region ?? "IN";
  const cards =
    typeof userId === "string" ? await exploreFeed(userId, region, 1) : [];

  return (
    <>
      {/* Not wrapped in <Screen>: its max-w-5xl fights the full-bleed feed.
          First route in the app to opt out -- but the header still needs its
          own padding, so it gets a band of exactly that (not Screen's, which
          also caps width and adds a gap below that this route doesn't want).
          components/explore-feed.tsx:66-ish subtracts this band's rendered
          height from the feed, so a change here must be mirrored there. */}
      <div className="px-5 pt-5 pb-3 sm:px-8 sm:pt-6">
        <AppHeader
          subtitle="Explore"
          actions={
            <Link href="/search" className={navLinkClass}>
              Search
            </Link>
          }
        />
      </div>
      <main className="flex flex-1 flex-col">
        {cards.length > 0 ? (
          <ExploreFeed initialCards={cards} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 py-20 text-center">
            <VennMark size={44} />
            <p className="t-section text-3xl text-fg">Nothing left to rate</p>
            <p className="t-body mx-auto max-w-sm text-[15px] text-fg-dim">
              Check back after the next release wave.
            </p>
          </div>
        )}
      </main>
    </>
  );
}
