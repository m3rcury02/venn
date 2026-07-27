"use client";

import { useTransition } from "react";
import { removeFromList } from "@/app/list/actions";
import { overlayButtonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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
      className={`${overlayButtonClass} opacity-75 hover:border-beam-a hover:bg-beam-a hover:text-on-beam hover:opacity-100 focus-visible:opacity-100`}
    >
      {isPending ? (
        <Spinner />
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
