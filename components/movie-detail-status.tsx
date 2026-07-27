"use client";

import { useState } from "react";
import type { Hype, Rating } from "@/app/status/actions";
import { VoteControl } from "@/components/vote-control";
import { WatchedToggle } from "@/components/watched-toggle";

export function MovieDetailStatus({
  movieId,
  initialWatched,
  initialRating,
  initialHype,
}: {
  movieId: string;
  initialWatched: boolean;
  initialRating: Rating | null;
  initialHype: Hype | null;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [rating, setRating] = useState(initialRating);
  const [hype, setHype] = useState(initialHype);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <WatchedToggle
          movieId={movieId}
          watched={watched}
          onChange={(next) => {
            setWatched(next);
            setRating(null);
            setHype(null);
          }}
        />
        <div>
          <p className="t-label text-fg-faint">Your status</p>
          <p className="t-body mt-1 text-[14px] text-fg-dim">
            {watched ? "Watched · rate it" : "Not watched · how hyped are you?"}
          </p>
        </div>
      </div>

      <VoteControl
        movieId={movieId}
        watched={watched}
        rating={rating}
        hype={hype}
        onChange={(value) => {
          if (watched) setRating(value as Rating | null);
          else setHype(value as Hype | null);
        }}
      />
    </div>
  );
}
