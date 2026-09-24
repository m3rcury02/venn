"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { confirmAge, declineAge } from "@/app/onboarding/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass } from "@/components/ui/input";

// The 18+ step at the start of onboarding. Two plain choices rather than a
// checkbox: a checkbox ticked by habit on the way to "Continue" says less
// than choosing between "I'm 18 or older" and "I'm under 18".
export function AgeGate() {
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result?.error) setError(result.error);
    });
  }

  return (
    <div className="flex max-w-lg flex-col gap-5">
      {declining ? (
        <div className="flex flex-col gap-4 rounded-card border border-hairline bg-surface/30 p-4">
          <p className="t-body text-[15px] text-fg">
            Sorry, Venn is only for people aged 18 and over.
          </p>
          <p className="t-body text-[14px] text-fg-dim">
            Signing in created an account with your email address. We&rsquo;ll
            delete it now, along with everything attached to it.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(declineAge)}
              className={buttonClass("beam")}
            >
              {isPending ? "Deleting…" : "Delete my account"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setDeclining(false)}
              className={buttonClass("ghost")}
            >
              Go back
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[15px] leading-relaxed text-fg-dim">
            By continuing you agree to the{" "}
            <Link href="/terms" className="text-marquee underline hover:text-fg">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-marquee underline hover:text-fg">
              Privacy Policy
            </Link>
            .
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(confirmAge)}
              className={buttonClass()}
            >
              {isPending ? "Saving…" : "I'm 18 or older"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => setDeclining(true)}
              className={buttonClass("ghost")}
            >
              I&rsquo;m under 18
            </button>
          </div>
        </>
      )}

      {error ? (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
