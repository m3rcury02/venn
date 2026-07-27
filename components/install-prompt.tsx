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
      className="fixed inset-x-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3"
      style={{
        bottom:
          "calc(env(safe-area-inset-bottom) + var(--mobile-nav-offset, 0px) + 1rem)",
      }}
    >
      {/* On `bg-surface` (#0B0B0D), not a fill -- the mark blends additively
          and needs a near-black backdrop to resolve. */}
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
          className="t-label bulb shrink-0 rounded-ctl bg-marquee px-3 py-2 text-on-beam"
        >
          Install
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-ctl px-2 py-1.5 text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg"
      >
        ×
      </button>
    </div>
  );
}
