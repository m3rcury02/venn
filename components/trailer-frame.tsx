"use client";

import { useEffect, useState } from "react";

// The trailer embed for the Explore feed. One rule drives playback: the
// iframe is only ever mounted while the card is active, so unmounting when
// the card scrolls away is what stops it -- no player API, no external
// script (the IFrame Player API was rejected on exactly that ground; see
// docs/DECISIONS.md, "Explore (post-phase-9 feature)").
//
// The still image is a separate concern and is NOT gated on `active`: it is
// the base layer for every card, active or not, so a card mid-swipe shows its
// art instead of an empty black rectangle. `backdropUrl` (native 16:9) is
// preferred over `posterUrl` (2:3, would be cropped by the aspect-video box)
// for that still. The iframe, when it mounts, layers on top rather than
// replacing the still, so starting playback never flashes black while
// YouTube loads.
//
// Reduced motion and save-data get no autoplay at all: those preferences are
// read on mount (they do not exist during SSR) and, when either is set, the
// active card shows an explicit play button over its still, whose tap mounts
// the same iframe.

type TrailerFrameProps = {
  trailerKey: string | null;
  backdropUrl: string | null;
  posterUrl: string | null;
  title: string;
  /** The card is the one on screen. False unmounts the iframe -- that is the
   *  stop mechanism. The still image ignores this. */
  active: boolean;
  muted: boolean;
};

export function TrailerFrame({
  trailerKey,
  backdropUrl,
  posterUrl,
  title,
  active,
  muted,
}: TrailerFrameProps) {
  const [prefs, setPrefs] = useState<{
    reducedMotion: boolean;
    saveData: boolean;
  } | null>(null);
  const [userStarted, setUserStarted] = useState(false);

  useEffect(() => {
    // matchMedia/navigator don't exist during SSR -- detect once on mount,
    // the same pattern as components/mobile-navigation.tsx:145-152.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs({
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      saveData:
        (
          navigator as Navigator & {
            connection?: { saveData?: boolean };
          }
        ).connection?.saveData === true,
    });
  }, []);

  // Autoplay when the preferences allow it, or when the user explicitly asked
  // via the play button. `prefs` starts null (SSR) -- nothing mounts until the
  // mount effect has read the real preferences.
  const canAutoplay =
    active && trailerKey && prefs !== null && !prefs.reducedMotion && !prefs.saveData;
  const playable = active && trailerKey && (userStarted || canAutoplay);
  const needsPlayButton =
    active && trailerKey && prefs && (prefs.reducedMotion || prefs.saveData);

  const stillUrl = backdropUrl ?? posterUrl;
  if (!stillUrl && !playable && !needsPlayButton) return null;

  return (
    <div className="absolute inset-0">
      {stillUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
        <img src={stillUrl} alt="" className="h-full w-full object-cover" />
      ) : null}
      {playable ? (
        <iframe
          // playsinline=1 is not optional: without it iOS takes the video
          // fullscreen and destroys the feed. loop=1 needs playlist={key} to
          // work on a single video -- a YouTube quirk, not a typo.
          src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&mute=${
            muted ? 1 : 0
          }&loop=1&playlist=${trailerKey}&controls=0&playsinline=1&modestbranding=1&rel=0`}
          title={`${title} trailer`}
          allow="autoplay; encrypted-media"
          className="absolute inset-0 h-full w-full"
          frameBorder={0}
        />
      ) : null}
      {needsPlayButton ? (
        <button
          type="button"
          aria-label={`Play trailer for ${title}`}
          onClick={() => setUserStarted(true)}
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-ctl border border-hairline bg-surface-2 text-fg">
            <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 fill-current">
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          </span>
        </button>
      ) : null}
    </div>
  );
}
