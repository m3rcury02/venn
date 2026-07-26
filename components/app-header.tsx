import Link from "next/link";
import type { ReactNode } from "react";
import { VennMark } from "@/components/venn-mark";

export const navLinkClass =
  "rounded-full px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg";

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
        <Link href="/" className="inline-flex items-center gap-2">
          <VennMark size={22} />
          <span className="text-xl font-semibold tracking-tight text-fg">
            Venn
          </span>
        </Link>
        <p className="mt-1 font-mono text-[11px] tracking-wider text-fg-faint uppercase">
          {subtitle}
        </p>
      </div>
      {actions || inboxCount !== undefined ? (
        <nav className="flex items-center gap-1">
          {/* The link renders whenever the caller has a user; only the count is
              conditional. Hiding the link at zero would make the Inbox appear
              and vanish from the nav, which reads as a bug rather than a badge. */}
          {inboxCount !== undefined ? (
            <Link href="/inbox" className={navLinkClass}>
              Inbox
              {inboxCount > 0 ? (
                <span className="ml-1.5 rounded-full bg-overlap px-1.5 py-0.5 font-mono text-[10px] text-overlap-fg">
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
