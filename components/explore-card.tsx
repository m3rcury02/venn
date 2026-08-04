"use client";

import { ExploreCardActions } from "@/components/explore-card-actions";
import { TrailerFrame } from "@/components/trailer-frame";
import type { ExploreCard as ExploreCardData } from "@/lib/movies/explore";

// A projection with a placard under it: the film's own palette floods the card
// through a blurred backdrop, the trailer is the sharp screen, and every
// control sits below it on the placard. The vote UI never overlays the video --
// this app is "a dark room, two projector beams, and a screen", and you do not
// put buttons on the screen. (The sound toggle is a transport control, not a
// vote, so it lives on the placard line under the frame.)

function formatRuntime(minutes: number | null) {
  if (minutes === null) return null;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${remainder}m`;
}

type ExploreCardViewProps = {
  card: ExploreCardData;
  /** The card is the one on screen -- only its trailer is mounted. */
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
  /** Feed position, read by the feed's IntersectionObserver via data-index. */
  index: number;
};

export function ExploreCardView({
  card,
  active,
  muted,
  onToggleMute,
  index,
}: ExploreCardViewProps) {
  const meta = [
    card.year !== null ? String(card.year) : null,
    formatRuntime(card.runtime),
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");

  return (
    <section
      aria-label={card.title}
      data-card
      data-index={index}
      className="relative flex h-full w-full snap-start snap-always flex-col justify-center overflow-hidden motion-safe:animate-expose"
    >
      {/* Blurred backdrop fills the whole card, behind everything -- the black
          around the 16:9 video is lit by the film's own colour, not dead space.
          Same treatment as components/poster.tsx and night-pick-hero.tsx. */}
      {card.backdropUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
        <img
          src={card.backdropUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-80 blur-2xl saturate-[2.1]"
        />
      ) : (
        // No backdrop: light the frame with the two beams instead of collapsing
        // the layout (night-pick-hero.tsx:49-56 verbatim).
        <div
          aria-hidden
          className="absolute inset-0 opacity-45 blur-2xl"
          style={{
            background:
              "radial-gradient(60% 70% at 22% 30%, var(--beam-a), transparent 65%), radial-gradient(60% 70% at 78% 75%, var(--beam-b), transparent 65%)",
          }}
        />
      )}

      {/* Enough scrim to keep the placard text at AA over arbitrary poster art. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-ink via-ink/75 to-ink/25"
      />

      {/* The screen and its placard share one column. On wide viewports
          aspect-video's width-driven height alone can exceed the card, so the
          column is capped: it may use all but 29.3rem of the viewport height
          (3.3rem for the AppHeader above the feed, 26rem that the placard
          always needs). max() floors the cap so a very short window cannot
          crush the column past a reading width. Below the cap the column is
          full width and phones are unchanged.

          26rem is 24.7rem (the pre-redesign measured figure, "Fix Explore
          desktop layout" commit) plus the net of every change made since:
          -3.5rem for the mute button, which no longer has its own row (it
          moved onto the title line below); +3.28rem to budget the 2nd title
          line the title's own max-height below now permits (a 2-line title
          used to just overflow uncapped and get clipped by this section --
          the same failure this constant exists to prevent); -0.5rem / +0.5rem
          from the meta and action-block margins moving to mt-2/mt-6;
          +0.25rem from ExploreCardActions' gap-2 -> gap-3; +1.28rem from
          VoteControl's `size="lg"` (`min-h-12` vs the old unsized sm row).
          Re-derived by arithmetic, then spot-checked against a real render
          (headless Chrome, both title lengths, 360-1440px wide, down to
          640px tall): no clipping anywhere, with room to spare -- so 26rem is
          a safe upper bound, not a tight one. Re-measure at 1440px after any
          further change to this column's content. */}
      <div className="relative mx-auto flex w-full max-w-[max(calc((100dvh_-_29.3rem)_*_16_/_9),24rem)] flex-col justify-center px-3 sm:px-6">
        <div className="relative aspect-video w-full overflow-hidden rounded-card border border-hairline bg-ink">
          <TrailerFrame
            trailerKey={card.trailerKey}
            backdropUrl={card.backdropUrl}
            posterUrl={card.posterUrl}
            title={card.title}
            active={active}
            muted={muted}
          />
        </div>

        {/* Mute lives on the title line now, not its own row -- it is a
            transport control, not a vote, so it never competes with the vote
            row below for the placard's primary weight. */}
        <div className="mt-4 flex items-start justify-between gap-3">
          {/* max-height + overflow-hidden, not `line-clamp-2`: `.t-display`'s
              intentional 0.82 line-height (poster lettering, see
              globals.css) is tighter than Anton's glyph metrics, and
              -webkit-line-clamp's own box-height accounting doesn't fully
              hide a 3rd line under that combination -- verified as a real
              render, not just a description: a few pixels of the clipped
              line's ascenders showed through under line 2. max-height on a
              plain block avoids it. No ellipsis as a result, which matches
              this app's own precedent for a hard-clipped display title:
              night-pick-hero.tsx's "the section clips it," no ellipsis
              there either. 1.64 is 2 lines' worth (2 * 0.82). */}
          <h2 className="t-display max-h-[calc(clamp(32px,9vw,64px)_*_1.64)] overflow-hidden text-[clamp(32px,9vw,64px)] text-fg">
            {card.title}
          </h2>
          {card.trailerKey ? (
            <button
              type="button"
              onClick={onToggleMute}
              aria-pressed={!muted}
              aria-label={muted ? "Unmute trailer" : "Mute trailer"}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-ctl border border-hairline bg-surface-2 text-fg-dim transition-colors hover:text-fg"
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-current"
              >
                <path
                  d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
                {muted ? (
                  <path d="m16 10 4 4M20 10l-4 4" strokeWidth="1.8" strokeLinecap="round" />
                ) : (
                  <path d="M16 9a4.5 4.5 0 0 1 0 6" strokeWidth="1.8" strokeLinecap="round" />
                )}
              </svg>
            </button>
          ) : null}
        </div>
        {/* White, not `--fg-dim`: night-pick-hero.tsx:86-90 documents why -- the
            dim tone measures 4.36:1 over real backdrop art and fails AA, and
            poster art is arbitrary so no scrim can be trusted to hold it. */}
        {meta ? <p className="t-label mt-2 text-fg">{meta}</p> : null}

        <div className="mt-6">
          <ExploreCardActions
            externalId={card.externalId}
            initialState={{
              movieId: card.movieId,
              isInList: card.isInList,
              watched: card.watched,
              rating: card.rating,
              hype: card.hype,
            }}
          />
        </div>
      </div>

      <div className="grain-art" aria-hidden />
    </section>
  );
}
