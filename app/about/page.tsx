import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "About — Venn",
  description: "Learn about Venn, shared movie lists, and our recommendation engine.",
};

export default function AboutPage() {
  return (
    <Screen width="narrow">
      <AppHeader subtitle="About Venn" />
      <div className="flex flex-col gap-6">
        <Panel>
          <h1 className="t-section text-fg">Shared movie lists &amp; group recommendations</h1>
          <p className="t-label mt-1 text-fg-faint">Last updated: {LAST_UPDATED}</p>
          <div className="t-body mt-4 flex flex-col gap-4 text-[15px] text-fg-dim">
            <p>
              Venn is designed for friends and film lovers who want to spend less time scrolling through streaming catalogues and more time actually watching movies together.
            </p>
            <p>
              By combining individual taste ratings, hype votes, and group membership, Venn finds the perfect overlap where everyone&apos;s preferences align.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">How the Recommender Works</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              <strong className="text-fg">1. Dynamic Tag Weights:</strong> Every rating you cast (hate, like, love) assigns normalized weights across movie genres, directors, cast members, and keywords.
            </p>
            <p>
              <strong className="text-fg">2. Hype Overrides:</strong> Expressing explicit hype (hyped or superhyped) for an unwatched title prioritizes it over purely inferred taste scores.
            </p>
            <p>
              <strong className="text-fg">3. Group Aggregation (&quot;Nobody Objects&quot;):</strong> For movie nights, Venn scores candidates across all present members, heavily weighting the minimum individual score so that no single person quietly resents the group&apos;s pick.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">Attribution &amp; Data Credits</h2>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col items-start gap-3 rounded-card border border-hairline bg-surface-2 p-4">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted */}
                <img
                  src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb224e516574beb27763f22d43538069b4881e5044df2813245345680d22.svg"
                  alt="TMDB Logo"
                  className="h-8 w-auto object-contain"
                />
                <span className="t-label text-fg text-sm">The Movie Database (TMDB)</span>
              </div>
              <p className="t-body text-[13px] text-fg-dim">
                This product uses the TMDB API but is not endorsed or certified by TMDB.
              </p>
            </div>
            <p className="t-body text-[12px] text-fg-faint">
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
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">Legal &amp; Privacy</h2>
          <div className="mt-3 flex items-center gap-4">
            <Link
              href="/privacy"
              className="t-label text-sm text-marquee hover:underline"
            >
              Privacy Policy
            </Link>
            <span className="text-fg-faint">•</span>
            <Link
              href="/terms"
              className="t-label text-sm text-marquee hover:underline"
            >
              Terms of Service
            </Link>
            <span className="text-fg-faint">•</span>
            <Link
              href="/accessibility"
              className="t-label text-sm text-marquee hover:underline"
            >
              Accessibility
            </Link>
          </div>
        </Panel>
      </div>
    </Screen>
  );
}
