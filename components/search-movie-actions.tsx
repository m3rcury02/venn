"use client";

import { useState, useTransition } from "react";
import {
  addToList,
  addWatchedToList,
  type AddToListResult,
} from "@/app/list/actions";
import type { Hype, Rating } from "@/app/status/actions";
import { Spinner } from "@/components/ui/spinner";
import { VoteControl } from "@/components/vote-control";

type MovieState = Extract<AddToListResult, { status: "added" | "already-in-list" }>;
type PendingAction = "add" | "watched" | null;

const actionClass =
  "t-label flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-ctl border px-1.5 text-center text-[10px] leading-[1.15] tracking-[0.02em] transition-colors disabled:pointer-events-none";

export function SearchMovieActions({
  externalId,
  listId,
}: {
  externalId: string;
  listId?: string;
}) {
  const [movie, setMovie] = useState<MovieState | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(action: Exclude<PendingAction, null>) {
    setMessage(null);
    setPendingAction(action);
    startTransition(async () => {
      const result =
        action === "add"
          ? await addToList(externalId, listId)
          : await addWatchedToList(externalId, listId);

      if (result.status === "error") {
        setMessage(result.message);
      } else {
        setMovie(result);
      }
      setPendingAction(null);
    });
  }

  function handleVote(value: Rating | Hype | null) {
    setMovie((current) => {
      if (!current) return current;
      return current.watched
        ? { ...current, rating: value as Rating | null }
        : { ...current, hype: value as Hype | null };
    });
  }

  const isAdded = movie !== null;
  const isWatched = movie?.watched ?? false;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={() => run("add")}
          disabled={isPending || isAdded}
          className={`${actionClass} ${
            isAdded
              ? "border-marquee bg-marquee text-on-beam"
              : "border-hairline bg-surface-2 text-fg hover:border-marquee"
          }`}
        >
          {pendingAction === "add" ? <Spinner /> : isAdded ? "Added" : "Add to list"}
        </button>
        <button
          type="button"
          onClick={() => run("watched")}
          disabled={isPending || isWatched}
          className={`${actionClass} ${
            isWatched
              ? "border-fg bg-fg text-ink"
              : "border-hairline bg-surface-2 text-fg hover:border-fg-dim"
          }`}
        >
          {pendingAction === "watched" ? (
            <Spinner />
          ) : isWatched ? (
            "Watched"
          ) : (
            "Mark watched"
          )}
        </button>
      </div>

      {message ? (
        <p className="rounded-ctl border border-beam-a/50 bg-ink px-2 py-1 text-[11px] text-fg">
          {message}
        </p>
      ) : null}

      {movie ? (
        <VoteControl
          movieId={movie.movieId}
          watched={movie.watched}
          rating={movie.rating}
          hype={movie.hype}
          onChange={handleVote}
        />
      ) : null}
    </div>
  );
}
