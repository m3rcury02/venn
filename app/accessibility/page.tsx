import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { CONTACT_EMAIL, LAST_UPDATED } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Accessibility Statement — Venn",
  description: "Accessibility commitment and standards for Venn shared movie lists.",
};

export default function AccessibilityPage() {
  return (
    <Screen width="narrow">
      <AppHeader subtitle="Accessibility Statement" />
      <div className="flex flex-col gap-6">
        <Panel>
          <h1 className="t-section text-fg">Accessibility Statement</h1>
          <p className="t-label mt-1 text-fg-faint">Last updated: {LAST_UPDATED}</p>
          <div className="t-body mt-4 flex flex-col gap-4 text-[15px] text-fg-dim">
            <p>
              Venn is committed to ensuring digital accessibility for all users, including people with visual, hearing, cognitive, and motor disabilities. We continuously improve the user experience for everyone and apply relevant accessibility standards.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">1. Conformance Standard</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              Venn strives to conform to the Web Content Accessibility Guidelines (WCAG) 2.1 Level AA standard. These guidelines define best practices to make web content accessible and user-friendly.
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">2. Key Features &amp; Design Practices</h2>
          <div className="t-body mt-3 flex flex-col gap-3 text-[14px] text-fg-dim">
            <p>
              <strong className="text-fg">Keyboard Navigation:</strong> All interactive elements, navigation drawers, modals, and buttons can be accessed and controlled using keyboard input alone. Focus rings are clearly visible.
            </p>
            <p>
              <strong className="text-fg">Color &amp; Contrast:</strong> Text and visual tokens maintain legibility against background elements, respecting high contrast requirements for legibility.
            </p>
            <p>
              <strong className="text-fg">Semantic Structure:</strong> Pages use standard HTML5 landmarks (<code className="text-marquee">&lt;nav&gt;</code>, <code className="text-marquee">&lt;main&gt;</code>, <code className="text-marquee">&lt;footer&gt;</code>, <code className="text-marquee">&lt;aside&gt;</code>) and proper ARIA role labels for dynamic states.
            </p>
            <p>
              <strong className="text-fg">Motion Settings:</strong> CSS animations honor user preferences for reduced motion (<code className="text-marquee">motion-safe</code> media queries).
            </p>
          </div>
        </Panel>

        <Panel>
          <h2 className="t-section text-lg text-fg">3. Ongoing Audit &amp; Feedback</h2>
          <p className="t-body mt-3 text-[14px] text-fg-dim">
            We regularly test user flows for accessibility compliance. If you encounter accessibility barriers, experience difficulty accessing any part of Venn, or have suggestions for improvement, please contact us:
          </p>
          <p className="t-body mt-3 text-[14px] text-fg-dim">
            Email:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-marquee underline hover:text-fg">
              {CONTACT_EMAIL}
            </a>
          </p>
        </Panel>
      </div>
    </Screen>
  );
}
