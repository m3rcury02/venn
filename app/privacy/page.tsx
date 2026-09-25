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
              <strong className="text-fg">Account Credentials &amp; Profile:</strong> Email address (via Google OAuth or magic link authentication), username, display name, avatar URL, and regional preferences. If you sign in with Google, Google shares your name and email address with us.
            </p>
            <p>
              <strong className="text-fg">Age Confirmation:</strong> The date and time you confirmed you are 18 or older.
            </p>
            <p>
              <strong className="text-fg">Movie Activity &amp; Taste Signals:</strong> Movie ratings (hate, like, love), hype statuses (dont_care, hyped, superhyped), watch history timestamps, personal and group list items, and group memberships. In a public group, your ratings and votes are used to pick a movie only on a night you have joined yourself; other members can&apos;t count you as present.
            </p>
            <p>
              <strong className="text-fg">Ingestion Text:</strong> Title text or URLs sent via the share target, iOS shortcut, or paste interface.
            </p>
            <p>
              <strong className="text-fg">Usage Analytics:</strong> Pages you view and in-app events (for example, adding a movie, casting a vote, creating a group or logging a movie night), linked to your account ID. Collected only after you have confirmed you are 18 or older and finished onboarding. Nothing is collected on the sign-in page, the legal pages or during onboarding.
            </p>
            <p>
              <strong className="text-fg">Abuse-Prevention Counters:</strong> Counts of how many searches and other requests your account made in the current time window (one minute to one hour, depending on the action), used to enforce fair-use limits. Only the latest count of each kind is kept, and all of them are deleted with your account. We also count requests per network, keyed by a one-way keyed hash of your IP address (for IPv6, of its network prefix). The address itself is never stored, the hash isn&apos;t linked to your account, and each count is deleted within an hour.
            </p>
            <p>
              <strong className="text-fg">Error Reports:</strong> When something breaks, on our servers or in your browser, we record the error message, the technical stack trace, the page address (without its query string), and the app version, so we can fix it. Error reports carry no account ID, email addresses are removed from them before they are sent, and they are collected on every page, including sign-in and onboarding, because those are where a fault would stop you from using Venn at all.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">2. Service Providers &amp; Data Sharing</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>We share data only with the providers needed to run the app. We do not sell your data.</p>
            <ul className="list-disc pl-5 flex flex-col gap-1.5">
              <li><strong className="text-fg">Supabase:</strong> Database host and authentication provider.</li>
              <li><strong className="text-fg">Vercel:</strong> Application hosting platform.</li>
              <li><strong className="text-fg">Google (sign-in):</strong> If you choose &quot;Sign in with Google&quot;, Google authenticates you and shares your name and email address with us. Google&apos;s own privacy policy covers what Google does with that sign-in.</li>
              <li><strong className="text-fg">TMDB:</strong> External metadata provider, queried from our servers for title metadata and imagery. Poster and backdrop images load directly from TMDB&apos;s image servers, so TMDB receives your IP address when your browser loads them.</li>
              <li><strong className="text-fg">YouTube (Google):</strong> Trailers on the Explore screen are embedded YouTube players, using YouTube&apos;s privacy-enhanced (youtube-nocookie.com) mode. When a trailer loads, which happens automatically for the card on screen unless your device asks for reduced motion or data saving, your browser connects to YouTube, and YouTube receives your IP address and device information and may store data on your device. YouTube&apos;s privacy policy applies to that player.</li>
              <li><strong className="text-fg">JustWatch:</strong> Where-to-watch availability is supplied by JustWatch through TMDB. We fetch it from our servers using only the title and your region; no personal data is sent to JustWatch. Streaming links on a movie page open the provider&apos;s own site, whose policies then apply.</li>
              <li><strong className="text-fg">PostHog:</strong> Product analytics and error reports (hosted in the EU), as described in section 1. Error reports are sent to PostHog from our servers, not from your browser.</li>
              <li><strong className="text-fg">Cloudflare Turnstile:</strong> If you sign in with an email link, a Cloudflare Turnstile check on the sign-in page confirms you aren&apos;t an automated script. Your browser connects to Cloudflare, which receives your IP address and browser signals for that check. Cloudflare&apos;s privacy policy applies to it. Google sign-in doesn&apos;t use it.</li>
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
          <h2 className="t-section text-lg text-fg">4. Children</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              Venn is only for people aged 18 and over. India&apos;s Digital Personal Data Protection Act treats anyone under 18 as a child, and processing a child&apos;s data requires verifiable parental consent, which we do not collect. Every account must confirm it is 18 or older before it can use the app. If you say you are under 18, your account and its data are deleted immediately.
            </p>
            <p>
              If you believe someone under 18 is using Venn, contact us at the address below and we will delete the account.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">5. Advertising</h2>
          <p className="t-body mt-3 text-[14px] text-fg-dim">
            Venn does not currently serve targeted advertisements. Placeholder ad surfaces exist in list views but are disabled by default, and no personal data or taste signals have been shared with any advertising network or external partner.
          </p>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">6. Contact &amp; Grievance Redressal</h2>
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
