"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { VennMark } from "@/components/venn-mark";

const HIDDEN_PATHS = ["/explore", "/login"];

export function SiteFooter() {
  const pathname = usePathname();

  if (
    HIDDEN_PATHS.some(
      (path) => pathname === path || pathname.startsWith(path + "/"),
    )
  ) {
    return null;
  }

  return (
    // `sm:pb-8`, not `sm:pb-0`: the extra mobile padding clears the tab
    // bar, but zeroing it on desktop left the legal links touching the
    // bottom edge of the page.
    <footer className="mt-auto border-t border-hairline px-5 py-8 pb-24 sm:px-8 sm:pb-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <div className="flex flex-col items-center gap-2 sm:items-start">
          <p className="flex items-center gap-2">
            <VennMark size={18} />
            {/* No year: this is a client component, and a year computed on
                both sides can disagree across midnight on 31 December. */}
            <span className="t-label text-fg-dim">Venn</span>
          </p>
          <p className="t-body text-[13px] text-fg-faint">
            This product uses the TMDB API but is not endorsed or certified by TMDB.
          </p>
        </div>
        <nav className="flex items-center gap-4">
          <Link
            href="/about"
            className="t-body text-[13px] text-fg-faint transition-colors hover:text-fg"
          >
            About
          </Link>
          <span className="text-fg-faint">•</span>
          <Link
            href="/privacy"
            className="t-body text-[13px] text-fg-faint transition-colors hover:text-fg"
          >
            Privacy
          </Link>
          <span className="text-fg-faint">•</span>
          <Link
            href="/terms"
            className="t-body text-[13px] text-fg-faint transition-colors hover:text-fg"
          >
            Terms
          </Link>
          <span className="text-fg-faint">•</span>
          <Link
            href="/accessibility"
            className="t-body text-[13px] text-fg-faint transition-colors hover:text-fg"
          >
            Accessibility
          </Link>
        </nav>
      </div>
    </footer>
  );
}
