"use client";

import { useEffect } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { VennMark } from "@/components/venn-mark";

// Catches render and data errors anywhere under the root layout. Until now the
// app had none, so any thrown Supabase error showed Next's default overlay in
// dev and a blank page in production.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is the only handle on the server-side stack in production;
    // the message itself is redacted before it reaches the client.
    console.error("[venn] unhandled error", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-5 py-14">
      <div aria-hidden className="absolute inset-x-0 top-0 h-6 bg-ink sm:h-9" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-6 bg-ink sm:h-9" />

      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center">
          <VennMark size={52} />
        </div>
        <h1 className="t-display mt-6 text-[clamp(40px,12vw,72px)] text-fg">
          Reel break
        </h1>
        <p className="t-body mt-5 text-[15px] text-fg-dim">
          Something went wrong on our side. Trying again usually sorts it.
        </p>
        {error.digest ? (
          <p className="t-label mt-4 font-mono text-fg-faint">{error.digest}</p>
        ) : null}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className={buttonClass("marquee")}>
            Try again
          </button>
          <Link href="/" className={buttonClass("ghost")}>
            My list
          </Link>
        </div>
      </div>
    </main>
  );
}
