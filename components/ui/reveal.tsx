"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { useRevealVariants } from "@/lib/motion";

// Scroll-triggered arrival for content wrapped as `children` -- the wrapped
// content itself stays server-rendered; only this frame around it is client.
// Replaces the eight mount-time `motion-safe:animate-expose` sites, but not
// with one behaviour for all of them (see the `trigger` prop).

type RevealProps = {
  children: ReactNode;
  /**
   * "view"  -- animates once the element scrolls into the *document*
   *            viewport. For content below the fold on arrival, which is the
   *            actual scroll-reveal fix this component exists for.
   * "mount" -- animates once on mount, no observer involved. For content
   *            that's already above the fold when the page arrives, where
   *            `whileInView` risks leaving it invisible if the observer
   *            callback races hydration.
   */
  trigger?: "view" | "mount";
  /** Feed/list position, for the staggered arrival. Capped the same way the
   *  pre-Framer version was (`Math.min(i, 10) * 40ms`) so a long list never
   *  schedules a multi-second cascade. */
  index?: number;
  className?: string;
};

export function Reveal({ children, trigger = "view", index = 0, className }: RevealProps) {
  const delay = Math.min(index, 10) * 0.04;
  const variants = useRevealVariants(delay);

  if (trigger === "mount") {
    return (
      <motion.div initial="hidden" animate="visible" variants={variants} className={className}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      // Pixel value, not a percentage: `margin` forwards to
      // IntersectionObserver's `rootMargin`, which some browsers reject as a
      // percentage without an explicit `root`.
      viewport={{ once: true, margin: "-64px 0px" }}
      variants={variants}
      className={className}
    >
      {children}
    </motion.div>
  );
}
