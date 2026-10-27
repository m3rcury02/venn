"use client";

import { useEffect, useState } from "react";
import { VennMark } from "@/components/venn-mark";
import { isIos, isStandalone, useDeferredInstallPrompt } from "@/lib/pwa-install";

const DISMISSED_KEY = "venn-install-dismissed";

export function InstallPrompt() {
  const { canPrompt, promptInstall } = useDeferredInstallPrompt();
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY) || isStandalone()) return;
    // Whether to show at all depends on localStorage/matchMedia, which don't
    // exist during SSR -- starting hidden and revealing here once mounted is
    // the correct fix for that, not a sync-with-render effect the lint rule
    // is meant to catch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(false);

    if (isIos()) setShowIosSteps(true);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    await promptInstall();
    dismiss();
  }

  if (dismissed || (!canPrompt && !showIosSteps)) return null;

  return (
    <div
      data-install-prompt
      // Thick glass: it floats over live content and carries `--fg-dim` body
      // text, which the clear tier can't hold at AA (globals.css, GLASS).
      className="glass-thick fixed inset-x-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-glass px-4 py-3 motion-safe:animate-lens-in"
      style={{
        bottom:
          "calc(env(safe-area-inset-bottom) + var(--mobile-nav-offset, 0px) + 1rem)",
      }}
    >
      {/* On dark glass, not a fill -- the mark blends additively and needs a
          near-black backdrop to resolve. The thick tier's worst case is
          rgb(37,37,38), still dark enough for the lens to read white. */}
      <VennMark size={28} />
      <div className="t-body min-w-0 flex-1 text-[14px]">
        {showIosSteps ? (
          <p className="text-fg-dim">
            Install Venn: tap <span className="text-fg">Share</span>, then{" "}
            <span className="text-fg">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="text-fg-dim">Install Venn for quicker access.</p>
        )}
      </div>
      {canPrompt ? (
        <button
          type="button"
          onClick={install}
          className="t-label bulb shrink-0 rounded-lg bg-marquee px-3 py-2 text-on-beam transition motion-safe:active:scale-[0.96]"
        >
          Install
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-dim transition-colors hover:bg-white/[0.08] hover:text-fg"
      >
        ×
      </button>
    </div>
  );
}
