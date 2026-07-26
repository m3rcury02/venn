"use client";

import { useTransition } from "react";
import { removeFromList } from "@/app/list/actions";

export function RemoveFromListButton({
  movieId,
  listId,
}: {
  movieId: string;
  listId?: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      await removeFromList(movieId, listId);
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      aria-label="Remove from list"
      className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-80 shadow-sm backdrop-blur-sm transition-all hover:scale-110 hover:bg-circle-a hover:opacity-100 focus-visible:opacity-100 disabled:opacity-60"
    >
      {isPending ? (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-white/40 border-t-white motion-safe:animate-spin motion-reduce:animate-pulse" />
      ) : (
        <svg
          viewBox="0 0 20 20"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <path d="M5 10h10" />
        </svg>
      )}
    </button>
  );
}
