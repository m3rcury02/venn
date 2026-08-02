"use client";

import { useState, useTransition } from "react";
import {
  addToList,
  addWatchedToList,
  removeFromList,
} from "@/app/list/actions";
import { setWatched, type Hype, type Rating } from "@/app/status/actions";
import { Spinner } from "@/components/ui/spinner";
import { VoteControl } from "@/components/vote-control";

// Search's vote semantics, ported from components/search-movie-actions.tsx.
// The one difference: this card's movieId is always non-null (the Explore pool
// is pre-cached), so VoteControl renders immediately -- no "added to a list
// first" gate. That is safe for setRating's UPDATE-only behaviour: the rating
// control only exists on a watched card, and watched rows were created by
// setWatched/addWatchedToList before the rating can be tapped.
type MovieState = {
  movieId: string;
  isInList: boolean;
  watched: boolean;
  rating: Rating | null;
  hype: Hype | null;
};
type PendingAction = "add" | "watched" | null;

const actionClass =
  "t-label flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-ctl border px-1.5 text-center text-[10px] leading-[1.15] tracking-[0.02em] transition-colors disabled:pointer-events-none";

export function ExploreCardActions({
  externalId,
  initialState,
}: {
  externalId: string;
  initialState: MovieState;
}) {
  const [movie, setMovie] = useState(initialState);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(action: Exclude<PendingAction, null>) {
    setMessage(null);
    setPendingAction(action);
    startTransition(async () => {
      if (action === "add" && movie.isInList) {
        const removed = await removeFromList(movie.movieId);
        if (removed) {
          setMovie((current) => ({ ...current, isInList: false }));
        } else {
          setMessage("Couldn't remove it from the list.");
        }
        setPendingAction(null);
        return;
      }

      if (action === "watched" && movie.watched) {
        const markedUnwatched = await setWatched(movie.movieId, false);
        if (markedUnwatched) {
          setMovie((current) => ({
            ...current,
            watched: false,
            rating: null,
            hype: null,
          }));
        } else {
          setMessage("Couldn't mark it unwatched.");
        }
        setPendingAction(null);
        return;
      }

      const result =
        action === "add"
          ? await addToList(externalId)
          : await addWatchedToList(externalId);

      if (result.status === "error") {
        setMessage(result.message);
      } else {
        setMovie({
          movieId: result.movieId,
          isInList: true,
          watched: result.watched,
          rating: result.rating,
          hype: result.hype,
        });
      }
      setPendingAction(null);
    });
  }

  function handleVote(value: Rating | Hype | null) {
    setMovie((current) => {
      return current.watched
        ? { ...current, rating: value as Rating | null }
        : { ...current, hype: value as Hype | null };
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={() => toggle("add")}
          disabled={isPending}
          aria-pressed={movie.isInList}
          className={`${actionClass} ${
            movie.isInList
              ? "border-marquee bg-marquee text-on-beam"
              : "border-hairline bg-surface-2 text-fg hover:border-marquee"
          }`}
        >
          {pendingAction === "add" ? (
            <Spinner />
          ) : movie.isInList ? (
            "Added"
          ) : (
            "Add to list"
          )}
        </button>
        <button
          type="button"
          onClick={() => toggle("watched")}
          disabled={isPending}
          aria-pressed={movie.watched}
          className={`${actionClass} ${
            movie.watched
              ? "border-fg bg-fg text-ink"
              : "border-hairline bg-surface-2 text-fg hover:border-fg-dim"
          }`}
        >
          {pendingAction === "watched" ? (
            <Spinner />
          ) : movie.watched ? (
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

      <VoteControl
        movieId={movie.movieId}
        watched={movie.watched}
        rating={movie.rating}
        hype={movie.hype}
        onChange={handleVote}
      />
    </div>
  );
}
