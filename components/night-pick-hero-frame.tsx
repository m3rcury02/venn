"use client";

import Link from "next/link";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { Poster } from "@/components/poster";
import { LinkPending } from "@/components/ui/link-pending";
import { EASE_EXPOSE } from "@/lib/motion";

type NightPickHeroFrameProps = {
  title: string;
  year: number | null;
  href: string;
  backdropUrl: string | null;
  posterUrl: string | null;
  reasons: string[];
};

// The animated half of night-pick-hero.tsx's reveal. Split out so the parent
// stays a plain data shell and this is the only client boundary the moment
// needs.
//
// The sequence follows the order a real screening does: the letterbox closes
// in first (the projector starting), then the backdrop blooms, the poster
// rises into frame, the label and title strike in, and the reasons stagger
// in beneath. Under reduced motion all of it collapses to one opacity fade,
// no positional movement -- the same precedent components/venn-loader.tsx
// sets for the CSS side of this system.
export function NightPickHeroFrame({
  title,
  year,
  href,
  backdropUrl,
  posterUrl,
  reasons,
}: NightPickHeroFrameProps) {
  const reduceMotion = useReducedMotion();

  const container: Variants = reduceMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.45, ease: "linear" } } }
    : { hidden: {}, visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } } };

  // Under reduced motion every child variant below is a no-op: the
  // container's own opacity fade is the entire animation, and nothing here
  // moves or blurs independently of it.
  const bar: Variants = reduceMotion
    ? {}
    : { hidden: { scaleY: 0 }, visible: { scaleY: 1, transition: { duration: 0.32, ease: EASE_EXPOSE } } };

  const backdropImage: Variants = reduceMotion
    ? {}
    : {
        hidden: { opacity: 0, filter: "blur(64px)" },
        visible: { opacity: 0.8, filter: "blur(40px)", transition: { duration: 0.6, ease: EASE_EXPOSE } },
      };
  const backdropGradient: Variants = reduceMotion
    ? {}
    : {
        hidden: { opacity: 0, filter: "blur(64px)" },
        visible: { opacity: 0.45, filter: "blur(40px)", transition: { duration: 0.6, ease: EASE_EXPOSE } },
      };

  const posterVariants: Variants = reduceMotion
    ? {}
    : {
        hidden: { opacity: 0, y: 28 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE_EXPOSE } },
      };

  const label: Variants = reduceMotion
    ? {}
    : {
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_EXPOSE } },
      };

  const titleVariants: Variants = reduceMotion
    ? {}
    : {
        hidden: { opacity: 0, x: -16 },
        visible: { opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE_EXPOSE } },
      };

  const reasonsContainer: Variants = reduceMotion
    ? {}
    : { hidden: {}, visible: { transition: { staggerChildren: 0.07 } } };

  const reasonItem: Variants = reduceMotion
    ? {}
    : {
        hidden: { opacity: 0, y: 6 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_EXPOSE } },
      };

  return (
    <Link
      href={href}
      prefetch={false}
      aria-label={`View details for ${title}`}
      className="relative block overflow-hidden rounded-card border border-hairline"
    >
      <motion.div initial="hidden" animate="visible" variants={container}>
        {/* Letterbox, first in the sequence and z-raised so it stays on top of
            the backdrop that animates in behind it -- see night-pick-hero.tsx
            for why this frame is letterboxed at all. */}
        <motion.div
          aria-hidden
          variants={bar}
          style={{ transformOrigin: "top" }}
          className="absolute inset-x-0 top-0 z-10 h-5 bg-ink sm:h-7"
        />
        <motion.div
          aria-hidden
          variants={bar}
          style={{ transformOrigin: "bottom" }}
          className="absolute inset-x-0 bottom-0 z-10 h-5 bg-ink sm:h-7"
        />

        {backdropUrl ? (
          // motion.img, not img -- @next/next/no-img-element doesn't match
          // this tag, but the reason a plain <img> is correct here still
          // holds: hotlinked provider CDN, never re-hosted.
          <motion.img
            src={backdropUrl}
            alt=""
            aria-hidden
            variants={backdropImage}
            className="absolute inset-0 h-full w-full scale-110 object-cover saturate-[2.1]"
          />
        ) : (
          // No poster: light the frame with the two beams instead of collapsing
          // the layout.
          <motion.div
            aria-hidden
            variants={backdropGradient}
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(60% 70% at 22% 30%, var(--beam-a), transparent 65%), radial-gradient(60% 70% at 78% 75%, var(--beam-b), transparent 65%)",
            }}
          />
        )}

        {/* Enough scrim to keep the title at AA over arbitrary poster art, and
            no more -- the point of the backdrop is that the film's own color
            reaches the page. */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-ink via-ink/75 to-ink/25"
        />

        <div className="relative flex flex-col gap-6 px-5 py-12 sm:flex-row sm:items-end sm:gap-8 sm:px-9 sm:py-16">
          <motion.div variants={posterVariants} className="w-32 shrink-0 sm:w-44">
            <Poster src={posterUrl} alt={title} glow={false} markSize={40} />
          </motion.div>

          <div className="min-w-0">
            <motion.p variants={label} className="t-label text-marquee">
              Tonight&rsquo;s pick
            </motion.p>
            {/* Deliberately allowed to run past the frame -- the section clips it. */}
            <motion.h2
              variants={titleVariants}
              className="t-display mt-3 -mr-6 text-[clamp(40px,12vw,96px)] text-fg"
            >
              {title}
            </motion.h2>
            {/* White, not `--fg-dim`. Measured off the rendered page: against
                the brightest pixel of a real blurred backdrop, `--fg-dim`
                came out 4.36:1 -- under AA. Poster art is arbitrary, so the
                scrim cannot be relied on to hold a muted tone. Hierarchy here
                comes from the 96px title, not from dimming the supporting
                lines. */}
            {year !== null ? (
              <motion.p variants={label} className="t-label mt-4 text-fg">
                {year}
              </motion.p>
            ) : null}

            {reasons.length > 0 ? (
              <motion.ul variants={reasonsContainer} className="mt-5 flex flex-col gap-1.5">
                {reasons.map((reason) => (
                  <motion.li key={reason} variants={reasonItem} className="t-body text-[15px] text-fg">
                    {reason}
                  </motion.li>
                ))}
              </motion.ul>
            ) : null}
          </div>
        </div>

        <div className="grain-art" aria-hidden />
      </motion.div>
      <LinkPending size={30} />
    </Link>
  );
}
