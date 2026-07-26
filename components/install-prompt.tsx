"use client";

import { useEffect, useState } from "react";
import { VennMark } from "@/components/venn-mark";

const DISMISSED_KEY = "venn-install-dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own flag -- iOS never fires beforeinstallprompt, so
    // display-mode alone would miss an already-installed iOS PWA.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
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

    if (isIos()) {
      setShowIosSteps(true);
      return;
    }

    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  async function install() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    dismiss();
  }

  if (dismissed || (!deferredPrompt && !showIosSteps)) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-surface-strong px-4 py-3 shadow-lg">
      <VennMark size={28} />
      <div className="min-w-0 flex-1 text-sm text-fg">
        {showIosSteps ? (
          <p className="text-fg-muted">
            Install Venn: tap <span className="text-fg">Share</span>, then{" "}
            <span className="text-fg">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="text-fg-muted">Install Venn for quicker access.</p>
        )}
      </div>
      {deferredPrompt ? (
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-full bg-overlap px-3 py-1.5 font-mono text-[10px] tracking-wider text-overlap-fg uppercase"
        >
          Install
        </button>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="shrink-0 rounded-full px-2 py-1.5 text-fg-faint transition-colors hover:bg-surface hover:text-fg"
      >
        ×
      </button>
    </div>
  );
}
