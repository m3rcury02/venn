"use client";

import { useEffect, useState, type ReactNode } from "react";

// The header floats as a glass bar once the page scrolls under it, and is
// invisible chrome at rest -- at the top of a page it looks exactly like the
// plain header it always was. sm+ only: on a phone the floating tab bar is
// the glass layer, and a sticky header would cost a fifth of the screen.
//
// "Stuck" is read from window.scrollY rather than a sentinel element: a
// sentinel has to be a sibling of the header, and AppHeader sits in both
// Screen's gap-10 column and Explore's plain band, which would need two
// different compensating margins. Passive listener, one rAF per frame at
// most, and a state update only when the boolean flips.
//
// The padding and negative margin are applied at rest too, so turning the
// glass on is a paint change, never a layout shift. They fit inside Screen's
// own `sm:px-8`, so the bar never reaches the viewport edge.

// Screen's `sm:py-12` minus the bar's `sm:top-3`: the scroll offset at which
// the header actually reaches its sticky position.
const STICK_AT = 36;

export function HeaderShell({ children }: { children: ReactNode }) {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const wide = window.matchMedia("(min-width: 40rem)");
    let frame = 0;
    const update = () => {
      frame = 0;
      setStuck(wide.matches && window.scrollY > STICK_AT);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    wide.addEventListener("change", update);
    return () => {
      window.removeEventListener("scroll", onScroll);
      wide.removeEventListener("change", update);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      className={`z-30 rounded-glass sm:sticky sm:top-3 sm:-mx-4 sm:-my-2 sm:px-4 sm:py-2 sm:transition-[background-color,box-shadow] sm:duration-300 ${
        stuck ? "glass-thick" : ""
      }`}
    >
      {children}
    </div>
  );
}
