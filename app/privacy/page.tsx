import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { CONTACT_EMAIL, LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Venn",
  description: "Privacy Policy for Venn shared movie lists and recommendations.",
};

export default function PrivacyPage() {
  return (
    <Screen width="narrow">
      <AppHeader subtitle="Privacy Policy" />
      <div className="flex flex-col gap-6">
        <Panel>
          <h1 className="t-section text-fg">Privacy Policy</h1>
          <p className="t-label mt-1 text-fg-faint">Last updated: {LAST_UPDATED}</p>
          <div className="t-body mt-4 flex flex-col gap-4 text-[15px] text-fg-dim">
            <p>
              Venn (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;) respects your privacy. This policy describes what information we collect, how it is stored and processed, and your rights regarding your data.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">1. Information We Collect</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              <strong className="text-fg">Account Credentials &amp; Profile:</strong> Email address (via Google OAuth or magic link authentication), username, display name, avatar URL, and regional preferences.
            </p>
            <p>
              <strong className="text-fg">Movie Activity &amp; Taste Signals:</strong> Movie ratings (hate, like, love), hype statuses (dont_care, hyped, superhyped), watch history timestamps, personal and group list items, and group memberships.
            </p>
            <p>
              <strong className="text-fg">Ingestion Text:</strong> Title text or URLs sent via the share target, iOS shortcut, or paste interface.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">2. Service Providers &amp; Data Sharing</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>We share data only with infrastructure providers necessary to operate the app:</p>
            <ul className="list-disc pl-5 flex flex-col gap-1.5">
              <li><strong className="text-fg">Supabase:</strong> Database host and authentication provider.</li>
              <li><strong className="text-fg">Vercel:</strong> Application hosting platform.</li>
              <li><strong className="text-fg">TMDB:</strong> External metadata provider (queried server-side for title metadata and imagery).</li>
              <li><strong className="text-fg">PostHog:</strong> Product analytics.</li>
              <li><strong className="text-fg">Resend:</strong> Transactional email service for weekly digests.</li>
            </ul>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">3. Retention &amp; User Rights (DPDP Act)</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              Your data is retained for as long as your account remains active. Under applicable privacy legislation (including India&apos;s DPDP Act), you have full control over your personal data:
            </p>
            <p>
              <strong className="text-fg">Data Export:</strong> You can download a JSON export of all your personal data at any time from your{" "}
              <Link href="/settings" className="text-marquee underline hover:text-fg">
                Settings
              </Link>{" "}
              page.
            </p>
            <p>
              <strong className="text-fg">Account Deletion:</strong> You can permanently delete your account at any time from{" "}
              <Link href="/settings" className="text-marquee underline hover:text-fg">
                Settings
              </Link>
              . Deletion erases your profile, ratings, list contributions, and notification preferences from our database.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">4. Advertising</h2>
          <p className="t-body mt-3 text-[14px] text-fg-dim">
            Venn does not currently serve targeted advertisements. Placeholder ad surfaces exist in list views but are disabled by default, and no personal data or taste signals have been shared with any advertising network or external partner.
          </p>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">5. Contact &amp; Grievance Redressal</h2>
          <p className="t-body mt-3 text-[14px] text-fg-dim">
            For privacy inquiries or grievance redressal, contact us at:{" "}
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
