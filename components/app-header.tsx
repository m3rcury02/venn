import Link from "next/link";
import type { ReactNode } from "react";
import { VennMark } from "@/components/venn-mark";

// `whitespace-nowrap` is load-bearing: without it "Movie night" and "Add
// movies" break mid-label on a 390px viewport.
export const navLinkClass =
  "t-label rounded-ctl px-3 py-2 whitespace-nowrap text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg";

type AppHeaderProps = {
  subtitle: string;
  actions?: ReactNode;
  /**
   * §5: "stay pending, badge the Inbox". Passed in rather than fetched here --
   * /login renders this header with no session at all, so a query inside the
   * component would have to handle a case that only exists because of where it
   * lives. The caller already knows whether it has a user.
   */
  inboxCount?: number;
};

export function AppHeader({ subtitle, actions, inboxCount }: AppHeaderProps) {
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
        <nav className="flex flex-wrap items-center justify-start gap-1 sm:justify-end">
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
    </header>
  );
}
