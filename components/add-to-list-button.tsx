"use client";

import { useState, useTransition } from "react";
import { addToList } from "@/app/list/actions";
import { VennMark } from "@/components/venn-mark";

type Status = "idle" | "added" | "already-in-list" | "error";

const badgeBase =
  "flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white shadow-sm backdrop-blur-sm transition-transform hover:scale-110 focus-visible:scale-110";

export function AddToListButton({ externalId }: { externalId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await addToList(externalId);
      setStatus(result.status);
      setMessage(result.status === "error" ? result.message : null);
    });
  }

  if (status === "added" || status === "already-in-list") {
    return (
      <span
        className={`${badgeBase} cursor-default bg-overlap hover:scale-100`}
        title={status === "added" ? "Added to your list" : "Already on your list"}
      >
        <VennMark size={16} animated={status === "added"} />
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-label="Add to list"
        className={`${badgeBase} disabled:opacity-60`}
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
          >
            <path d="M10 4v12M4 10h12" />
          </svg>
        )}
      </button>
      {status === "error" && message ? (
        <p className="max-w-[8rem] rounded-md bg-black/70 px-2 py-1 text-right text-[11px] text-white">
          {message}
        </p>
      ) : null}
    </div>
  );
}
