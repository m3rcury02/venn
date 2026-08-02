import Link from "next/link";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { ExploreFeed } from "@/components/explore-feed";
import { exploreFeed } from "@/lib/movies/explore";
import { createClient } from "@/lib/supabase/server";
import { VennMark } from "@/components/venn-mark";

// The Explore trailer feed (post-phase-9 feature). Distinct from SPEC §7's
// screen 9 "Discover" -- that is the phase-10 people directory (search users,
// browse public lists and groups), which lives in a different feature.
export default async function ExplorePage() {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
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
      {/* Not wrapped in <Screen>: its max-w-5xl px-5 py-8 fights the
          full-bleed feed. First route in the app to opt out. */}
      <AppHeader
        subtitle="Explore"
        actions={
          <Link href="/search" className={navLinkClass}>
            Search
          </Link>
        }
      />
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
    </>
  );
}
