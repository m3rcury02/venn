"use client";

import { useEffect, useState } from "react";

// The trailer embed for the Explore feed. One rule drives the whole component:
// the iframe is only ever mounted while the card is active, so unmounting when
// the card scrolls away is what stops playback -- no player API, no external
// script (the IFrame Player API was rejected on exactly that ground; see
// docs/DECISIONS.md, "Explore (post-phase-9 feature)").
//
// Reduced motion and save-data get no autoplay at all: those preferences are
// read on mount (they do not exist during SSR) and, when either is set, the
// card shows its poster with an explicit play button whose tap mounts the
// same iframe.

type TrailerFrameProps = {
  trailerKey: string | null;
  posterUrl: string | null;
  title: string;
  /** The card is the one on screen. False unmounts the iframe -- that is the
   *  stop mechanism. */
  active: boolean;
  muted: boolean;
};

export function TrailerFrame({
  trailerKey,
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

  if (playable) {
    return (
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
    );
  }

  // No trailer, reduced motion, save-data, or the card is off-screen: the
  // poster fills the same frame, so nothing shifts when playback starts.
  const showPoster = active && posterUrl;
  const needsPlayButton =
    active && trailerKey && prefs && (prefs.reducedMotion || prefs.saveData);

  if (!showPoster && !needsPlayButton) return null;

  return (
    <div className="absolute inset-0">
      {showPoster ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
        <img src={posterUrl!} alt="" className="h-full w-full object-cover" />
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
