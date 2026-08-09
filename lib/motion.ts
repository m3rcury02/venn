import { useReducedMotion, type Variants } from "motion/react";

// The Framer-driven counterpart to app/globals.css's animation block. Same
// two ideas as the CSS `expose` keyframe -- content coming up to exposure --
// expressed as variants so the handful of places that need scroll- or
// sequence-driven timing (components/ui/reveal.tsx, night-pick-hero.tsx,
// login/page.tsx) share one curve and one shape instead of each inventing
// its own.

// Identical to globals.css's --animate-expose curve, so anything animated by
// Framer settles at the same rate as anything still animated by CSS.
export const EASE_EXPOSE = [0.22, 0.8, 0.3, 1] as const;

// The `expose` keyframe (globals.css) as Framer variants: lifts, settles, and
// gains its own brightness rather than a generic fade.
export const exposeVariants: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.985, filter: "brightness(0.35)" },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "brightness(1)",
    transition: { duration: 0.5, ease: EASE_EXPOSE },
  },
};

// Press = the lamp dips. Contracts and darkens; release blooms back. Used by
// the handful of controls that are already client components and animate a
// tap directly, rather than through the `active:` CSS the rest of the app's
// controls use (see docs/DECISIONS.md).
export const pressTap = { scale: 0.97, filter: "brightness(0.85)" };
export const pressTapSubtle = { scale: 0.98 };

/**
 * Wraps `useReducedMotion()` so a caller never has to remember the guard --
 * under reduced motion every sequence collapses to an opacity-only fade, no
 * positional movement, matching the precedent components/venn-loader.tsx
 * already sets for the CSS side of the system. For sequences that supply
 * their own timing (stagger orchestration in night-pick-hero.tsx and
 * login/page.tsx).
 */
export function useMotionVariants(): Variants {
  const reduce = useReducedMotion();
  return reduce
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.4, ease: "linear" } } }
    : exposeVariants;
}

/**
 * Same shape as `useMotionVariants()`, with a per-instance delay baked into
 * the variant's own transition rather than passed as a sibling `transition`
 * prop -- a variant's own transition takes precedence over one supplied at
 * the component level, so merging it here (instead of relying on that
 * precedence) is what makes the delay reliable. Used by
 * components/ui/reveal.tsx for the index-derived stagger.
 */
export function useRevealVariants(delaySeconds: number): Variants {
  const reduce = useReducedMotion();
  return reduce
    ? {
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { duration: 0.4, ease: "linear", delay: delaySeconds } },
      }
    : {
        hidden: exposeVariants.hidden,
        visible: {
          ...(exposeVariants.visible as object),
          transition: { duration: 0.5, ease: EASE_EXPOSE, delay: delaySeconds },
        },
      };
}
