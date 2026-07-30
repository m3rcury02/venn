"use client";

import { useRef, useState } from "react";
import type { Hype, Rating } from "@/app/status/actions";
import { Panel } from "@/components/ui/panel";
import { VoteControl } from "@/components/vote-control";
import { WatchedToggle } from "@/components/watched-toggle";
import { createClient } from "@/lib/supabase/client";

export type MovieVotePercentages = {
  hyped_percent: number | null;
  loved_percent: number | null;
};

export function MovieDetailStatus({
  movieId,
  initialWatched,
  initialRating,
  initialHype,
  initialPercentages,
}: {
  movieId: string;
  initialWatched: boolean;
  initialRating: Rating | null;
  initialHype: Hype | null;
  initialPercentages: MovieVotePercentages;
}) {
  const [watched, setWatched] = useState(initialWatched);
  const [rating, setRating] = useState(initialRating);
  const [hype, setHype] = useState(initialHype);
  const [percentages, setPercentages] = useState(initialPercentages);
  const percentageRequestId = useRef(0);

  async function refreshPercentages() {
    const requestId = ++percentageRequestId.current;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_movie_vote_percentages", {
      p_movie_id: movieId,
    });

    if (error) {
      console.error("[venn] global vote percentages failed", error);
      return;
    }

    const next = (data as unknown as MovieVotePercentages[] | null)?.[0];
    if (next && requestId === percentageRequestId.current) {
      setPercentages(next);
    }
  }

  return (
    <>
      <Panel>
        <h2 className="t-label text-fg-faint">Venn voters</h2>
        <div className="mt-4 grid grid-cols-2 divide-x divide-hairline">
          <VotePercentage
            label="Hyped"
            value={percentages.hyped_percent}
            emptyLabel="No hype votes yet"
            populationLabel="of hype voters"
          />
          <VotePercentage
            label="Loved"
            value={percentages.loved_percent}
            emptyLabel="No ratings yet"
            populationLabel="of ratings"
          />
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <WatchedToggle
              movieId={movieId}
              watched={watched}
              onChange={(next) => {
                setWatched(next);
                setRating(null);
                setHype(null);
                void refreshPercentages();
              }}
            />
            <div>
              <p className="t-label text-fg-faint">Your status</p>
              <p className="t-body mt-1 text-[14px] text-fg-dim">
                {watched
                  ? "Watched · rate it"
                  : "Not watched · how hyped are you?"}
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
              void refreshPercentages();
            }}
          />
        </div>
      </Panel>
    </>
  );
}

function VotePercentage({
  label,
  value,
  emptyLabel,
  populationLabel,
}: {
  label: string;
  value: number | null;
  emptyLabel: string;
  populationLabel: string;
}) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <p className="t-label text-fg-faint">{label}</p>
      <p className="t-data mt-2 text-4xl text-fg">
        {value === null ? "—" : `${value}%`}
      </p>
      <p className="t-body mt-2 text-[12px] text-fg-dim">
        {value === null ? emptyLabel : populationLabel}
      </p>
    </div>
  );
}
