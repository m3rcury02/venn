import type { ReactNode } from "react";

// The lifted surface, previously `rounded-2xl bg-surface p-4` copied across
// five files. Near-square and hairline-bordered rather than rounded and
// shadowed -- in this system depth comes from light spill, not from shadow.
type PanelProps = {
  children: ReactNode;
  className?: string;
};

export function Panel({ children, className }: PanelProps) {
  return (
    <div
      className={`rounded-card border border-hairline bg-surface p-4 ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
