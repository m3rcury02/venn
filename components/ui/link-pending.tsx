"use client";

import { useLinkStatus } from "next/link";
import { VennLoader } from "@/components/venn-loader";

// The dead-tap fix.
//
// `loading.tsx` does NOT fire for the filter chips, the present picker or
// reroll. Those navigate to the *same route* with different searchParams, and
// Next runs `<Link>` navigations inside a transition -- the whole point of
// which is that the old UI stays on screen instead of falling back. So the
// route-level boundary never engages and the tap looks like nothing happened,
// for as long as Supabase takes.
//
// `useLinkStatus()` reports the pending state of the enclosing `<Link>`, and
// only works in a client component rendered as its descendant. Dropping this
// inside a chip covers the chip you actually tapped -- which is also the
// answer to "which one did I press", something a page-level loader cannot
// express.
//
// The parent must be `relative`; this fills it.
export function LinkPending({ size = 16 }: { size?: number }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span className="absolute inset-0 z-10 flex items-center justify-center rounded-ctl bg-ink/85">
      <VennLoader size={size} label="Loading" />
    </span>
  );
}
