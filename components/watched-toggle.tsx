"use client";

import { useTransition } from "react";
import { setWatched } from "@/app/status/actions";

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
      className={`flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm backdrop-blur-sm transition-transform hover:scale-110 focus-visible:scale-110 disabled:opacity-60 ${
        watched ? "bg-overlap" : "bg-black/60"
      }`}
    >
      {isPending ? (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white motion-safe:animate-spin motion-reduce:animate-pulse" />
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
