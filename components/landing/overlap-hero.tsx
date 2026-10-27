"use client";

import { MotionConfig, motion } from "motion/react";
import { EASE_EXPOSE } from "@/lib/motion";

// The product in one picture: three people's tastes drift in from apart,
// overlap, and the pick appears where all three cross. Circles because they
// stand for people (globals.css: circles are reserved for the mark and for
// people), blended with `plus-lighter` like the mark, so each overlap is
// brighter than either circle and the three-way centre is the brightest
// thing on the page. No film art: this is a marketing page, and studio key
// art isn't ours to advertise with.
//
// Decorative, so the whole figure is aria-hidden; the headline beside it
// says the same thing in words.
//
// Reduced motion is handled by <MotionConfig reducedMotion="user">, not by
// branching on useReducedMotion(): that hook can't know the preference on
// the server, so any element rendered or omitted on it hydrates into a
// different tree than the server sent (React #418 -- found exactly that way,
// with the flash below). MotionConfig skips the movement and keeps the fades;
// the flash is hidden by CSS (`motion-reduce:hidden`), which the server and
// the client agree on.

type Person = {
  name: string;
  color: string;
  /** Peak strength of the disc's light, in % of `color`. */
  strength: number;
  /** Resting centre, in % of the figure. */
  x: number;
  y: number;
  /** Where it drifts in from, in % of its own size. */
  fromX: number;
  fromY: number;
  /** Which side of the circle its name tag sits on. */
  tag: "left" | "right" | "bottom";
};

// Two beams and plain white -- no third hue. White is what the beams make
// where they meet, so "you" is drawn as the light that completes the overlap
// rather than as a new brand colour (the palette has none to spare, and
// docs/DECISIONS.md is explicit about not drifting toward violet).
const PEOPLE: Person[] = [
  {
    name: "Asha",
    color: "var(--beam-a)",
    strength: 78,
    x: 36,
    y: 38,
    fromX: -60,
    fromY: -30,
    tag: "left",
  },
  {
    name: "Ben",
    color: "var(--beam-b)",
    strength: 78,
    x: 64,
    y: 38,
    fromX: 60,
    fromY: -30,
    tag: "right",
  },
  { name: "You", color: "#ffffff", strength: 26, x: 50, y: 62, fromX: 0, fromY: 55, tag: "bottom" },
];

const REASONS = ["All 3 of you are hyped for this", "Nobody here has seen it"];

const SETTLE = { type: "spring" as const, stiffness: 60, damping: 16, mass: 1.1 };

export function OverlapHero() {
  return (
    <MotionConfig reducedMotion="user">
      <div aria-hidden className="relative mx-auto w-full max-w-[440px]">
        <div className="relative isolate aspect-square w-full">
          {PEOPLE.map((person, i) => (
            <motion.div
              key={person.name}
              className="absolute h-[54%] w-[54%]"
              style={{ left: `${person.x - 27}%`, top: `${person.y - 27}%` }}
              initial={{ x: `${person.fromX}%`, y: `${person.fromY}%`, opacity: 0 }}
              animate={{ x: 0, y: 0, opacity: 1 }}
              transition={{ ...SETTLE, delay: 0.15 + i * 0.08 }}
            >
              {/* The light: a soft disc that adds where it crosses another. */}
              <span
                className="absolute inset-0 rounded-full"
                style={{
                  background: `radial-gradient(circle at 50% 50%, color-mix(in srgb, ${person.color} ${person.strength}%, transparent) 0%, color-mix(in srgb, ${person.color} ${Math.round(person.strength * 0.75)}%, transparent) 62%, color-mix(in srgb, ${person.color} ${Math.round(person.strength * 0.13)}%, transparent) 100%)`,
                  mixBlendMode: "plus-lighter",
                }}
              />
              {/* The edge: a hairline rim, so each person reads as a whole
                circle even where the light washes out. */}
              <span className="absolute inset-0 rounded-full border border-white/25" />
              <span
                className={`glass t-label absolute rounded-full px-3 py-1.5 text-fg ${
                  person.tag === "left"
                    ? "top-[18%] -left-3"
                    : person.tag === "right"
                      ? "top-[18%] -right-3"
                      : "-bottom-3 left-1/2 -translate-x-1/2"
                }`}
              >
                {person.name}
              </span>
            </motion.div>
          ))}

          {/* The flash where all three land -- the mark's own `beam-flash`,
            re-timed into this sequence. */}
          <motion.span
            className="absolute top-[46%] left-1/2 h-[46%] w-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full motion-reduce:hidden"
            style={{
              background:
                "radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,255,255,0) 70%)",
              mixBlendMode: "plus-lighter",
            }}
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: [0, 0.95, 0], scale: [0.3, 1.15, 1.6] }}
            transition={{ duration: 1, delay: 1.05, ease: "easeOut" }}
          />

          {/* The pick, sitting in the three-way overlap. Abstract art made of
            the two beams, never a real poster. */}
          <motion.div
            className="absolute top-[46%] left-1/2 w-[19%] -translate-x-1/2 -translate-y-1/2"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 1.2, ease: EASE_EXPOSE }}
          >
            <div className="relative aspect-[2/3] overflow-hidden rounded-card border border-white/40 bg-ink shadow-[0_18px_50px_-10px_rgba(0,0,0,0.9)]">
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(120% 70% at 20% 15%, var(--beam-a), transparent 60%), radial-gradient(120% 80% at 85% 95%, var(--beam-b), transparent 60%), #000",
                }}
              />
              <div className="absolute inset-x-[14%] bottom-[12%] flex flex-col gap-[6%]">
                <span className="block h-[5px] w-full rounded-full bg-white/90" />
                <span className="block h-[5px] w-2/3 rounded-full bg-white/60" />
              </div>
              <div className="grain-art" />
            </div>
          </motion.div>
        </div>

        <div className="mt-6 flex flex-col items-center gap-2">
          <motion.p
            className="t-label text-marquee"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 1.45, ease: EASE_EXPOSE }}
          >
            Tonight&rsquo;s pick
          </motion.p>
          {REASONS.map((reason, i) => (
            <motion.span
              key={reason}
              className="glass t-body rounded-xl px-3.5 py-2 text-[14px] text-fg"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 1.55 + i * 0.09, ease: EASE_EXPOSE }}
            >
              {reason}
            </motion.span>
          ))}
        </div>
      </div>
    </MotionConfig>
  );
}
