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

      <div className="relative flex flex-col justify-center px-3 sm:px-6">
        <div className="relative aspect-video w-full overflow-hidden rounded-card border border-hairline bg-ink">
          <TrailerFrame
            trailerKey={card.trailerKey}
            posterUrl={card.posterUrl}
            title={card.title}
            active={active}
            muted={muted}
          />
        </div>

        {card.trailerKey ? (
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={onToggleMute}
              aria-pressed={!muted}
              aria-label={muted ? "Unmute trailer" : "Mute trailer"}
              className="flex h-11 w-11 items-center justify-center rounded-ctl border border-hairline bg-surface-2 text-fg-dim transition-colors hover:text-fg"
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
          </div>
        ) : null}

        <h2 className="t-display mt-4 text-[clamp(32px,9vw,64px)] text-fg">
          {card.title}
        </h2>
        {/* White, not `--fg-dim`: night-pick-hero.tsx:86-90 documents why -- the
            dim tone measures 4.36:1 over real backdrop art and fails AA, and
            poster art is arbitrary so no scrim can be trusted to hold it. */}
        {meta ? <p className="t-label mt-4 text-fg">{meta}</p> : null}

        <div className="mt-4">
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
