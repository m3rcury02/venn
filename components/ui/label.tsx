import type { ReactNode } from "react";

// The uppercase eyebrow used ~28 times across the app. It was monospace; it is
// now Archivo at `wdth 118`, which is why this app loads no monospace webfont.
// The `.t-label` rule in globals.css owns the width-axis value so it is set in
// exactly one place.

export const labelClass = "t-label text-fg-faint";

type LabelProps = {
  children: ReactNode;
  className?: string;
};

export function Label({ children, className }: LabelProps) {
  return <p className={`${labelClass} ${className ?? ""}`}>{children}</p>;
}
