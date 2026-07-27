import Link from "next/link";
import type { ReactNode } from "react";
import { VennMark } from "@/components/venn-mark";

// `whitespace-nowrap` is load-bearing: without it "Movie night" and "Add
// movies" break mid-label on a 390px viewport.
export const navLinkClass =
  "t-label relative flex min-h-11 items-center rounded-ctl px-3 py-2 whitespace-nowrap text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg";

type AppHeaderProps = {
  subtitle: string;
  actions?: ReactNode;
  /** Page-specific actions that must remain reachable above the mobile tabs. */
  mobileActions?: ReactNode;
  /**
   * §5: "stay pending, badge the Inbox". Passed in rather than fetched here --
   * the home page already has the count, and the shared mobile navigation owns
   * its own badge so every protected route can show it.
   */
  inboxCount?: number;
};

export function AppHeader({
  subtitle,
  actions,
  mobileActions,
  inboxCount,
}: AppHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <Link href="/" className="inline-flex items-center gap-2.5">
          <VennMark size={26} />
          <span className="t-display text-[26px] text-fg">Venn</span>
        </Link>
        <p className="t-label mt-1.5 text-fg-faint">{subtitle}</p>
      </div>
      {actions || inboxCount !== undefined ? (
        <nav className="hidden flex-wrap items-center justify-end gap-1 sm:flex">
          {/* The link renders whenever the caller has a user; only the count is
              conditional. Hiding the link at zero would make the Inbox appear
              and vanish from the nav, which reads as a bug rather than a badge. */}
          {inboxCount !== undefined ? (
            <Link href="/inbox" className={navLinkClass}>
              Inbox
              {inboxCount > 0 ? (
                <span className="t-data ml-1.5 rounded-ctl bg-marquee px-1.5 py-0.5 text-[10px] text-on-beam">
                  {inboxCount}
                </span>
              ) : null}
            </Link>
          ) : null}
          {actions}
        </nav>
      ) : null}
      {mobileActions ? (
        <nav className="flex w-full flex-wrap items-center gap-1 sm:hidden">
          {mobileActions}
        </nav>
      ) : null}
    </header>
  );
}
