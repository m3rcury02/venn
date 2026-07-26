import Link from "next/link";
import type { ReactNode } from "react";
import { VennMark } from "@/components/venn-mark";

export const navLinkClass =
  "rounded-full px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-surface hover:text-fg";

type AppHeaderProps = {
  subtitle: string;
  actions?: ReactNode;
};

export function AppHeader({ subtitle, actions }: AppHeaderProps) {
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
      {actions ? (
        <nav className="flex items-center gap-1">{actions}</nav>
      ) : null}
    </header>
  );
}
