"use client";

import { useTransition } from "react";
import { setHype, setRating, type Hype, type Rating } from "@/app/status/actions";

type VoteControlProps = {
  movieId: string;
  watched: boolean;
  rating: Rating | null;
  hype: Hype | null;
};

const RATING_OPTIONS: { value: Rating; label: string }[] = [
  { value: "hate", label: "Hated" },
  { value: "like", label: "Liked" },
  { value: "love", label: "Loved" },
];

const HYPE_OPTIONS: { value: Hype; label: string }[] = [
  { value: "dont_care", label: "Meh" },
  { value: "hyped", label: "Hyped" },
  { value: "superhyped", label: "Very hyped" },
];

const buttonBase =
  "flex-1 rounded-full py-1 text-[10px] font-medium tracking-wide transition-colors disabled:opacity-60";
const unselected = "bg-surface-strong text-fg-muted hover:text-fg";
// `hate` is the one value that's negative in kind, not just lower (SPEC §4.1
// gives it the only negative tag weight) -- it gets circle-a instead of the
// shared overlap fill every other selected value uses.
const selectedOverlap = "bg-overlap text-overlap-fg";
const selectedHate = "bg-circle-a text-white";

export function VoteControl({ movieId, watched, rating, hype }: VoteControlProps) {
  const [isPending, startTransition] = useTransition();

  const current = watched ? rating : hype;
  const options = watched ? RATING_OPTIONS : HYPE_OPTIONS;

  function handleClick(value: Rating | Hype) {
    const next = current === value ? null : value;
    startTransition(async () => {
      if (watched) {
        await setRating(movieId, next as Rating | null);
      } else {
        await setHype(movieId, next as Hype | null);
      }
    });
  }

  return (
    <div className="flex gap-1" role="group" aria-label={watched ? "Rating" : "Hype"}>
      {options.map((option) => {
        const isSelected = current === option.value;
        const selectedClass = option.value === "hate" ? selectedHate : selectedOverlap;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            disabled={isPending}
            onClick={() => handleClick(option.value)}
            className={`${buttonBase} ${isSelected ? selectedClass : unselected}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
