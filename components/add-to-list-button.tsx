"use client";

import { useState, useTransition } from "react";
import { addToList } from "@/app/list/actions";
import { overlayButtonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { VennMark } from "@/components/venn-mark";

type Status = "idle" | "added" | "already-in-list" | "error";

export function AddToListButton({
  externalId,
  listId,
}: {
  externalId: string;
  listId?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await addToList(externalId, listId);
      setStatus(result.status);
      setMessage(result.status === "error" ? result.message : null);
    });
  }

  if (status === "added" || status === "already-in-list") {
    const label =
      status === "added"
        ? listId
          ? "Added to the group list"
          : "Added to your list"
        : listId
          ? "Already on the group list"
          : "Already on your list";

    return (
      // Deliberately `bg-ink`, not a colored fill: the mark composites with
      // `plus-lighter` and only resolves to white on black. On a bright
      // backdrop it would clip to white everywhere and disappear.
      <span
        className={`${overlayButtonClass} cursor-default bg-ink`}
        title={label}
        role="status"
      >
        <VennMark size={18} animated={status === "added"} />
        <span className="sr-only">{label}</span>
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
        className={`${overlayButtonClass} hover:border-marquee hover:bg-marquee hover:text-on-beam`}
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
          >
            <path d="M10 4v12M4 10h12" />
          </svg>
        )}
      </button>
      {status === "error" && message ? (
        <p className="max-w-[9rem] rounded-ctl border border-beam-a/50 bg-ink px-2 py-1 text-right text-[11px] text-fg">
          {message}
        </p>
      ) : null}
    </div>
  );
}
