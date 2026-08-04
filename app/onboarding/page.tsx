import { redirect } from "next/navigation";
import { loadPopularOnboarding } from "@/app/onboarding/actions";
import { OnboardingProfileForm } from "@/components/onboarding-profile-form";
import { OnboardingTaste } from "@/components/onboarding-taste";
import { Screen } from "@/components/ui/screen";
import { VennMark } from "@/components/venn-mark";
import { provider } from "@/lib/providers";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, region, onboarded_at")
    .eq("id", userId)
    .single();

  if (profile?.onboarded_at) redirect("/");

  if (!profile?.username) {
    const regions = await provider.regions();
    return (
      <Screen width="narrow">
        <div className="flex items-center gap-3">
          <VennMark size={30} />
          <span className="font-display text-2xl uppercase tracking-[0.08em] text-fg">
            Venn
          </span>
        </div>
        <div className="flex flex-col gap-3">
          <p className="t-label text-marquee">Step 1 of 2</p>
          <h1 className="t-display text-[clamp(48px,14vw,88px)] text-fg">
            Make it yours
          </h1>
          <p className="max-w-lg text-[16px] leading-relaxed text-fg-dim">
            Pick the handle friends will know and the region Venn should use
            for releases and streaming availability.
          </p>
        </div>
        <OnboardingProfileForm
          regions={regions}
          initialRegion={profile?.region ?? "IN"}
        />
      </Screen>
    );
  }

  const [{ count }, movies] = await Promise.all([
    supabase
      .from("user_movie_status")
      .select("movie_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .not("rating", "is", null),
    loadPopularOnboarding(1),
  ]);

  return (
    <Screen>
      <div className="flex items-center gap-3">
        <VennMark size={30} />
        <span className="font-display text-2xl uppercase tracking-[0.08em] text-fg">
          Venn
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <p className="t-label text-marquee">Step 2 of 2</p>
        <h1 className="t-display text-[clamp(48px,14vw,96px)] text-fg">
          Show us your taste
        </h1>
        <p className="max-w-2xl text-[16px] leading-relaxed text-fg-dim">
          Rate ten popular movies you&rsquo;ve seen. These signals give your
          first group picks something real to work with.
        </p>
      </div>
      <OnboardingTaste initialMovies={movies} initialCount={count ?? 0} />
    </Screen>
  );
}
