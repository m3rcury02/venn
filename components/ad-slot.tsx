import Link from "next/link";
import { ADS_ENABLED } from "@/lib/ads";

export function AdSlot({ slot }: { slot: string }) {
  if (!ADS_ENABLED) return null;

  return (
    <aside
      data-ad-slot={slot}
      aria-label="Advertisement"
      className="rounded-card border border-dashed border-hairline bg-surface px-4 py-6 text-center"
    >
      <p className="t-label text-fg-faint">Advertisement</p>
      <p className="t-body mt-1 text-[13px] text-fg-dim">
        Supporting Venn keeps watch night free for everyone.{" "}
        <Link href="/about" className="underline hover:text-fg">
          Learn more
        </Link>
      </p>
    </aside>
  );
}
