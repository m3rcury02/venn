"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { noneOfThese } from "@/app/groups/[id]/night/actions";
import { buttonClass } from "@/components/ui/button";

// SPEC §4.5: reroll is relabelled "None of these" rather than joined by a
// second button -- the spec's reroll bullet is the mechanic, the
// none-of-these bullet is the logging; they describe one act.
//
// Navigates client-side (useRouter), not via redirect() from the server
// action: every redirect() in this repo is reached from
// <form action={formAction}> + useActionState, and there is no precedent for
// redirecting out of a bare startTransition call. This also keeps isPending
// true through the navigation, preserving the pending affordance that
// LinkPending (Link-only) can't provide here.
//
// Trade-off worth recording: reroll now requires JS, unlike the rest of this
// page's URL state (present-picker.tsx explains why that's normally a server-
// rendered Link). LogNightButton on the same screen already requires JS, and
// "Start over" stays a plain Link, so the page doesn't become JS-only -- but
// the departure is real.
export function NoneOfThese({
  groupId,
  mode,
  movieIds,
  rerollHref,
}: {
  groupId: string;
  mode: "home" | "theatre";
  movieIds: string[];
  rerollHref: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await noneOfThese(groupId, mode, movieIds); // best-effort -- navigate regardless
          router.push(rerollHref);
        })
      }
      className={buttonClass("marquee")}
    >
      {isPending ? "Finding more…" : "None of these"}
    </button>
  );
}
