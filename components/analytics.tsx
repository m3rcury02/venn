"use client";

import posthog from "posthog-js";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import { ANALYTICS_COOKIE } from "@/lib/analytics/cookie";

// PostHog starts only for a browser carrying the analytics cookie, which
// lib/supabase/proxy.ts sets once the signed-in user has confirmed they are
// 18 or older and finished onboarding. Signed-out pages (login, legal) and
// the onboarding flow itself are therefore never tracked: the DPDP Act bars
// behavioural tracking of children, and until the age step nobody has said
// they aren't one.
function analyticsAllowed(): boolean {
  return document.cookie
    .split(";")
    .some((part) => part.trim() === `${ANALYTICS_COOKIE}=1`);
}

// Idempotent, and re-checked on every navigation rather than once on mount:
// finishing onboarding is a client-side navigation, so the cookie appears
// mid-session and the next pageview is what should start tracking.
function ensureStarted(key: string): boolean {
  if (posthog.__loaded) return true;
  if (!analyticsAllowed()) return false;

  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
  });
  return true;
}

function AnalyticsPageView({ posthogKey }: { posthogKey: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname || !ensureStarted(posthogKey)) return;

    let url = window.origin + pathname;
    if (searchParams?.toString()) {
      url = `${url}?${searchParams.toString()}`;
    }
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams, posthogKey]);

  return null;
}

export function Analytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;

  return (
    <Suspense fallback={null}>
      <AnalyticsPageView posthogKey={key} />
    </Suspense>
  );
}
