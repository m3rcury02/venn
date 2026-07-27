"use client";

import { useTransition } from "react";
import { setWatched } from "@/app/status/actions";
import { overlayButtonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function WatchedToggle({ movieId, watched }: { movieId: string; watched: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await setWatched(movieId, !watched);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-pressed={watched}
      aria-label={watched ? "Mark unwatched" : "Mark watched"}
      title={watched ? "Watched" : "Not watched"}
      // White for watched, matching VoteControl's middle value and the mark's
      // overlap -- "both beams landed here" is the same idea as "seen it".
      className={`${overlayButtonClass} ${
        watched ? "border-fg bg-fg text-ink" : "hover:border-fg-dim"
      }`}
    >
      {isPending ? (
        <Spinner />
      ) : (
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 10s2.8-5 8-5 8 5 8 5-2.8 5-8 5-8-5-8-5Z" />
          <circle cx="10" cy="10" r="2" />
        </svg>
      )}
    </button>
  );
}
