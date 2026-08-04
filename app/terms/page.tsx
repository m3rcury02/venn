import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { CONTACT_EMAIL, LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service — Venn",
  description: "Terms of Service for Venn shared movie lists and recommendations.",
};

export default function TermsPage() {
  return (
    <Screen width="narrow">
      <AppHeader subtitle="Terms of Service" />
      <div className="flex flex-col gap-6">
        <Panel>
          <h1 className="t-section text-fg">Terms of Service</h1>
          <p className="t-label mt-1 text-fg-faint">Last updated: {LAST_UPDATED}</p>
          <div className="t-body mt-4 flex flex-col gap-4 text-[15px] text-fg-dim">
            <p>
              Welcome to Venn. By accessing or using our application, you agree to these Terms of Service.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">1. Acceptable Use &amp; Community Standards</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              You agree to use Venn responsibly. You must not upload, post, or share any abusive, harassing, hateful, or illegal content in usernames, display names, list titles, or movie notes.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">2. Account Removal &amp; Moderation</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              We provide block and report tools to keep the platform safe. We reserve the right to review reported content and remove accounts or content that violate these community standards.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">3. Movie Data &amp; TMDB Terms</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              Movie and TV metadata, poster images, and watch availability data are supplied by TMDB and JustWatch.
            </p>
            <p>
              This product uses the TMDB API but is not endorsed or certified by TMDB. All movie metadata and trademarks belong to their respective copyright holders and are subject to TMDB&apos;s terms of service.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">4. Disclaimer of Warranties</h2>
          <p className="t-body mt-3 text-[14px] text-fg-dim">
            Venn is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, express or implied, during its free development and operation.
          </p>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">5. Questions &amp; Contact</h2>
          <p className="t-body mt-3 text-[14px] text-fg-dim">
            For questions regarding these terms, please contact us at:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-marquee underline hover:text-fg">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Panel>
      </div>
    </Screen>
  );
}
