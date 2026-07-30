import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";
import type { NightMode } from "@/components/present-picker";

// Phase 9. Modelled directly on present-picker.tsx: server-rendered, no client
// JS, mode lives in the URL so the picks stay shareable with the rest of the
// group. Switching mode is handed a full href by the caller (night/page.tsx's
// nightHref) rather than building one here, because the caller also has to
// decide whether `exclude` survives the switch (it doesn't -- see there).

const chipBase = "t-label relative rounded-full px-4 py-2 transition-colors";
const chipOn = "bg-marquee text-on-beam";
const chipOff = "border border-hairline text-fg-dim hover:border-fg-dim hover:text-fg";

export function NightModePicker({
  mode,
  homeHref,
  theatreHref,
}: {
  mode: NightMode;
  homeHref: string;
  theatreHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={homeHref}
        aria-pressed={mode === "home"}
        className={`${chipBase} ${mode === "home" ? chipOn : chipOff}`}
      >
        Home
        <LinkPending size={14} />
      </Link>
      <Link
        href={theatreHref}
        aria-pressed={mode === "theatre"}
        className={`${chipBase} ${mode === "theatre" ? chipOn : chipOff}`}
      >
        Theatre
        <LinkPending size={14} />
      </Link>
    </div>
  );
}
