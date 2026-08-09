"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, useTransition } from "react";
import { setHype, setRating, type Hype, type Rating } from "@/app/status/actions";

type VoteControlProps = {
  movieId: string;
  watched: boolean;
  rating: Rating | null;
  hype: Hype | null;
  onChange?: (value: Rating | Hype | null) => void;
  /** `lg` is Explore's only caller: the vote row is the card's primary
   *  action, so it gets the app's real `.t-label` size instead of the
   *  compromise below. Every other caller stays `sm` (the default). */
  size?: "sm" | "lg";
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
//
// `lg` is Explore's opt-in: its vote row is the card's primary action, so it
// gets `.t-label`'s real 11px instead of the 10px width-squeeze. Tracking
// stays 0.02em either way -- that is the part that actually buys back the
// width "Very hyped" needs, and a taller button doesn't change that.
//
// `relative` is load-bearing now beyond LinkPending's usual reason: the
// selected fill below is an absolutely-positioned `motion.span` inset to the
// button, and the label needs to sit above it.
const buttonBaseBySize: Record<"sm" | "lg", string> = {
  sm: "t-label relative flex flex-1 min-w-0 items-center justify-center overflow-hidden rounded-ctl px-1 py-2 text-center text-[10px] leading-[1.15] tracking-[0.02em] wrap-anywhere transition-colors motion-safe:active:scale-[0.97] disabled:opacity-50",
  lg: "t-label relative flex min-h-12 flex-1 min-w-0 items-center justify-center overflow-hidden rounded-ctl px-2 py-2.5 text-center text-[11px] leading-[1.15] tracking-[0.02em] wrap-anywhere transition-colors motion-safe:active:scale-[0.97] disabled:opacity-50",
};
const unselected = "bg-surface-2 text-fg-dim hover:text-fg active:text-fg";

// The scale is the mark, unrolled. `--beam-a` is the low end, `--beam-b` the
// high end, and the middle value is WHITE -- which is precisely what those two
// beams make where they overlap (see components/venn-mark.tsx). So the control
// and the logo are the same statement.
//
// Note this is a design-system choice, not a SPEC-mandated asymmetry. SPEC
// §4.1 singles out `hate` as the only negative tag weight, but `love` is just
// the top of a linear positive range -- nothing in the spec makes the poles
// qualitatively different from each other.
//
// Split into fill/text rather than one combined class string: the fill now
// lives on a separate `motion.span` (so it can carry a `layoutId` and slide),
// and the label text sits on top of it, so each needs its own class.
const toneFor: Record<Rating | Hype, { fill: string; text: string }> = {
  hate: { fill: "bg-beam-a", text: "text-on-beam" },
  dont_care: { fill: "bg-beam-a", text: "text-on-beam" },
  like: { fill: "bg-fg", text: "text-ink" },
  hyped: { fill: "bg-fg", text: "text-ink" },
  love: { fill: "bg-beam-b", text: "text-on-beam" },
  superhyped: { fill: "bg-beam-b", text: "text-on-beam" },
};

export function VoteControl({
  movieId,
  watched,
  rating,
  hype,
  onChange,
  size = "sm",
}: VoteControlProps) {
  const [isPending, startTransition] = useTransition();
  const reduceMotion = useReducedMotion();
  const buttonBase = buttonBaseBySize[size];

  const serverValue = watched ? rating : hype;
  // Local, optimistic selection. The fill has to move the instant a button is
  // tapped -- not once setRating/setHype's round trip resolves, which is what
  // animating off the `rating`/`hype` props directly would mean, since this
  // row stays disabled (`isPending` below) for the length of that request.
  const [selected, setSelected] = useState(serverValue);

  // The server value is the source of truth once it actually changes -- a
  // revalidated page, a vote cast elsewhere. This only fires on a genuine
  // change to `serverValue`, not on every `isPending` flip, so it can't race
  // the optimistic update above: while a request is in flight `serverValue`
  // hasn't moved yet, and once it does it already matches what this row set
  // optimistically (or corrects to what the server actually holds).
  useEffect(() => {
    // Syncing local selection to a prop that only changes from outside this
    // component's own writes; same pattern as install-prompt.tsx and
    // mobile-navigation.tsx use for syncing to something outside React's
    // render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(serverValue);
  }, [serverValue]);

  const options = watched ? RATING_OPTIONS : HYPE_OPTIONS;
  // One layoutId per row+mode -- if the row is both the rating and hype
  // control at different times (watched toggles), the two must not share a
  // group, or toggling `watched` would try to slide the fill between two
  // completely different button sets.
  const layoutGroup = `vote-fill-${movieId}-${watched ? "rating" : "hype"}`;

  function handleClick(value: Rating | Hype) {
    const next = selected === value ? null : value;
    setSelected(next);
    startTransition(async () => {
      if (watched) {
        await setRating(movieId, next as Rating | null);
      } else {
        await setHype(movieId, next as Hype | null);
      }
      onChange?.(next);
    });
  }

  return (
    <div
      className="flex items-stretch gap-1"
      role="group"
      aria-label={watched ? "Rating" : "Hype"}
    >
      {options.map((option) => {
        const isSelected = selected === option.value;
        const tone = toneFor[option.value];
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            disabled={isPending}
            onClick={() => handleClick(option.value)}
            className={`${buttonBase} ${isSelected ? tone.text : unselected}`}
          >
            {isSelected ? (
              <motion.span
                layoutId={layoutGroup}
                aria-hidden
                className={`absolute inset-0 ${tone.fill}`}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 500, damping: 40 }
                }
              />
            ) : null}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
