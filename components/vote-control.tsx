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

// `.t-label`'s 0.6875rem/0.18em was tuned to exactly one viewport (390) and
// still only fit "Very hyped" by wrapping -- every phone narrower than 388px,
// and iPad portrait at 768-775px, overflowed the page (see docs/DECISIONS.md,
// "VoteControl label size" entry). text-[10px] + a tighter 0.02em tracking
// buys back enough width to clear those; `min-w-0` overrides flex's default
// min-width:auto floor and `wrap-anywhere` gives it somewhere to go if a
// future label is even longer, so the row can never widen the page. It is
// still allowed to wrap, and `items-center` on a stretched flex row is what
// keeps the two one-line siblings the same height as it.
const buttonBase =
  "t-label flex flex-1 min-w-0 items-center justify-center rounded-ctl px-1 py-2 text-center text-[10px] leading-[1.15] tracking-[0.02em] wrap-anywhere transition-colors disabled:opacity-50";
const unselected = "bg-surface-2 text-fg-dim hover:text-fg";

// The scale is the mark, unrolled. `--beam-a` is the low end, `--beam-b` the
// high end, and the middle value is WHITE -- which is precisely what those two
// beams make where they overlap (see components/venn-mark.tsx). So the control
// and the logo are the same statement.
//
// Note this is a design-system choice, not a SPEC-mandated asymmetry. SPEC
// §4.1 singles out `hate` as the only negative tag weight, but `love` is just
// the top of a linear positive range -- nothing in the spec makes the poles
// qualitatively different from each other.
const selectedLow = "bg-beam-a text-on-beam";
const selectedMid = "bg-fg text-ink";
const selectedHigh = "bg-beam-b text-on-beam";

function selectedClassFor(value: Rating | Hype) {
  if (value === "hate" || value === "dont_care") return selectedLow;
  if (value === "love" || value === "superhyped") return selectedHigh;
  return selectedMid;
}

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
    <div
      className="flex items-stretch gap-1"
      role="group"
      aria-label={watched ? "Rating" : "Hype"}
    >
      {options.map((option) => {
        const isSelected = current === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            disabled={isPending}
            onClick={() => handleClick(option.value)}
            className={`${buttonBase} ${
              isSelected ? selectedClassFor(option.value) : unselected
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
