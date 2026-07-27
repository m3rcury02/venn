"use client";

import { useSyncExternalStore } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari's own flag -- iOS never fires beforeinstallprompt, so
    // display-mode alone would miss an already-installed iOS PWA.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Module-scope singleton, not per-component state: the banner and the
// side-menu row must observe the SAME beforeinstallprompt event, since it can
// only be .prompt()'d once -- independent copies would go stale the moment
// either surface consumes (or the browser retires) the shared event.
let deferredEvent: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

function setDeferredEvent(event: BeforeInstallPromptEvent | null) {
  deferredEvent = event;
  subscribers.forEach((notify) => notify());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    setDeferredEvent(e as BeforeInstallPromptEvent);
  });
  window.addEventListener("appinstalled", () => setDeferredEvent(null));
}

function subscribe(onStoreChange: () => void) {
  subscribers.add(onStoreChange);
  return () => subscribers.delete(onStoreChange);
}

function getSnapshot() {
  return deferredEvent !== null;
}

function getServerSnapshot() {
  return false;
}

export function useDeferredInstallPrompt() {
  const canPrompt = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  async function promptInstall() {
    const event = deferredEvent;
    if (!event) return;
    // Clear before awaiting -- also closes the double-tap race where both
    // the banner and the menu row call promptInstall() on the same event.
    setDeferredEvent(null);
    await event.prompt();
    await event.userChoice;
  }

  return { canPrompt, promptInstall };
}
