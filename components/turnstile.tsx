"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

// Cloudflare Turnstile on the magic-link form: the signup-side half of "one
// person, many accounts" (the other half is lib/rate-limit.ts's per-network
// budget). A magic link needs nothing but an email address, and disposable
// addresses are free, so without this a script can mint accounts, each with
// a fresh per-user budget. Google sign-in isn't gated: Supabase can't put a
// captcha in front of OAuth, and Google already makes accounts cost something.
//
// Supabase verifies the token, not Venn: signInWithOtp passes it through and
// the project's Auth settings hold the secret. The token is single-use, so the
// widget is reset after every submit.
//
// Explicit rendering (render=explicit + turnstile.render) rather than the
// script's implicit scan for .cf-turnstile: the scan runs once, when the script
// loads, so a client-side navigation back to /login would find no widget.

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      theme?: "dark" | "light" | "auto";
      size?: "normal" | "flexible" | "compact";
      callback?: (token: string) => void;
      "expired-callback"?: () => void;
      "error-callback"?: () => void;
    },
  ) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function Turnstile({
  siteKey,
  onToken,
  resetSignal,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Any change resets the widget, for a fresh token after a submit. */
  resetSignal: unknown;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // The callbacks are handed to Cloudflare once, at render; a ref keeps them
  // calling the latest onToken without re-rendering the widget.
  const tokenHandler = useRef(onToken);
  useEffect(() => {
    tokenHandler.current = onToken;
  }, [onToken]);

  function renderWidget() {
    if (!window.turnstile || !container.current || widgetId.current) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: siteKey,
      theme: "dark",
      size: "flexible",
      callback: (token) => tokenHandler.current(token),
      "expired-callback": () => tokenHandler.current(null),
      "error-callback": () => tokenHandler.current(null),
    });
  }

  useEffect(() => {
    // Already loaded by an earlier visit to /login in this tab.
    renderWidget();
    return () => {
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
    // renderWidget reads refs and a prop that never changes at runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
    tokenHandler.current(null);
  }, [resetSignal]);

  return (
    <>
      <Script src={SCRIPT_SRC} strategy="afterInteractive" onReady={renderWidget} />
      <div ref={container} className="min-h-[65px]" />
    </>
  );
}
