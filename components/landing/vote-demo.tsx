"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

// A working copy of components/vote-control.tsx for the signed-out landing
// page: same scale, same colours, same sliding fill, but local state only.
// The real control writes through server actions that need a session, so it
// can't be dropped onto a public page as-is. Keep the two visually in step:
// if VoteControl's tones or labels change, change them here too.

const RATING = [
  { value: "hate", label: "Hated", fill: "bg-beam-a", text: "text-on-beam" },
  { value: "like", label: "Liked", fill: "bg-fg", text: "text-ink" },
  { value: "love", label: "Loved", fill: "bg-beam-b", text: "text-on-beam" },
] as const;

const HYPE = [
  { value: "dont_care", label: "Meh", fill: "bg-beam-a", text: "text-on-beam" },
  { value: "hyped", label: "Hyped", fill: "bg-fg", text: "text-ink" },
  { value: "superhyped", label: "Very hyped", fill: "bg-beam-b", text: "text-on-beam" },
] as const;

const SAYS: Record<string, string> = {
  hate: "Noted. Films like this drop down your picks, and the group's.",
  like: "Good to know. A nudge toward more like it.",
  love: "Strongest signal there is. Its genres, cast and director all count up.",
  dont_care: "Not a priority, but it won't rule the film out. Only hating does that.",
  hyped: "It counts in the film's favour next movie night.",
  superhyped: "Top of the pile. Your hype outranks any guess about your taste.",
};

export function VoteDemo() {
  const reduce = useReducedMotion();
  const [watched, setWatched] = useState(false);
  const [selected, setSelected] = useState<string | null>("hyped");
  const options = watched ? RATING : HYPE;

  function toggleWatched() {
    setWatched((current) => !current);
    setSelected(null);
  }

  return (
    <div className="glass rounded-glass p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="t-label text-fg">{watched ? "Seen it" : "Not seen yet"}</p>
        <button
          type="button"
          onClick={toggleWatched}
          aria-pressed={watched}
          className="t-label flex min-h-11 items-center gap-2 rounded-xl px-3 text-fg transition-colors hover:bg-white/10 motion-safe:active:scale-[0.96]"
        >
          <span
            aria-hidden
            className={`flex h-5 w-5 items-center justify-center rounded-md border transition-colors ${
              watched ? "border-fg bg-fg text-ink" : "border-white/40"
            }`}
          >
            {watched ? (
              <svg
                viewBox="0 0 20 20"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.4}
              >
                <path d="m5 10.5 3.2 3L15 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </span>
          Watched
        </button>
      </div>

      <div
        className="mt-4 flex items-stretch gap-1"
        role="group"
        aria-label={watched ? "Rating" : "Hype"}
      >
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(isSelected ? null : option.value)}
              className={`t-label relative flex min-h-12 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-ctl px-2 py-2.5 text-center text-[11px] leading-[1.15] tracking-[0.02em] transition-colors motion-safe:active:scale-[0.97] ${
                isSelected ? option.text : "bg-surface-2 text-fg-dim hover:text-fg"
              }`}
            >
              {isSelected ? (
                <motion.span
                  layoutId={`landing-vote-${watched ? "rating" : "hype"}`}
                  aria-hidden
                  className={`absolute inset-0 ${option.fill}`}
                  transition={
                    reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }
                  }
                />
              ) : null}
              <span className="relative">{option.label}</span>
            </button>
          );
        })}
      </div>

      {/* Fixed height, so changing the vote never shifts the page. White at
          80% on lens glass measures 5.46:1 worst case (globals.css, GLASS). */}
      <p aria-live="polite" className="t-body mt-4 min-h-[3em] text-[14px] leading-snug text-fg/80">
        {selected
          ? SAYS[selected]
          : watched
            ? "Rate it once you've seen it."
            : "Tap one. Change your mind any time."}
      </p>
    </div>
  );
}
