import { captureServer } from "@/lib/analytics/server";

// Error tracking, through the PostHog project Venn already sends analytics to
// (SPEC §1), as `$exception` events that PostHog's Error Tracking groups into
// issues and can alert on. Not Sentry: that would be a new dependency, a new
// vendor for the privacy policy, and a new account, for the same outcome at
// this scale.
//
// Reports are anonymous on purpose. They carry the error, the route and the
// deploy, never a user id, and PostHog is told not to build a person profile
// from them. That keeps them outside the analytics consent gate
// (lib/analytics/cookie.ts), which matters: login and onboarding are exactly
// where a broken deploy loses people, and neither is tracked.

export type ErrorContext = {
  source: "server" | "client";
  path?: string;
  digest?: string;
  method?: string;
  routePath?: string;
  routeType?: string;
  routerKind?: string;
  /** Client only: which handler caught it (route boundary, window.onerror...). */
  mechanism?: string;
  /** Client only: a random per-tab id, so PostHog can count affected sessions. */
  sessionId?: string;
};

type Frame = {
  platform: "custom";
  lang: "javascript";
  function: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
};

const MAX_FRAMES = 50;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

// Error messages can quote user input back (a Postgres constraint error on a
// username, an auth error naming an address). Emails are the one kind of
// personal data likely to turn up, so they never leave.
function redact(text: string): string {
  return text.replace(EMAIL, "[email]");
}

// V8 ("    at fn (file:1:2)", "    at file:1:2") and Firefox/Safari
// ("fn@file:1:2"). Anything else is dropped rather than guessed at.
const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const GECKO_FRAME = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

function parseStack(stack: string): Frame[] {
  const frames: Frame[] = [];
  for (const line of stack.split("\n")) {
    const match = line.match(V8_FRAME) ?? line.match(GECKO_FRAME);
    if (!match) continue;
    const [, fn, filename, lineno, colno] = match;
    frames.push({
      platform: "custom",
      lang: "javascript",
      function: fn || "<anonymous>",
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  // Stacks print innermost first; PostHog, like Sentry, wants the throwing
  // frame last.
  return frames.reverse();
}

// Next throws these on purpose to drive notFound(), redirect() and dynamic
// rendering. They aren't failures and shouldn't page anyone.
function isControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_") ||
      digest === "DYNAMIC_SERVER_USAGE" ||
      digest === "BAILOUT_TO_CLIENT_SIDE_RENDERING")
  );
}

/**
 * Sends one error to PostHog. Never throws: a failure to report must not turn
 * into a second failure. Always logs too, so Vercel's runtime logs keep a copy
 * when PostHog isn't configured.
 */
export async function reportError(error: unknown, context: ErrorContext): Promise<void> {
  if (isControlFlow(error)) return;

  const err =
    error instanceof Error ? error : new Error(typeof error === "string" ? error : "Non-Error thrown");
  const message = redact(err.message || "(no message)");
  const stack = err.stack ? redact(err.stack) : "";

  console.error("[venn] reported error", context.source, context.path ?? "", context.digest ?? "", err);

  try {
    await captureServer(context.sessionId ?? crypto.randomUUID(), "$exception", {
      $exception_list: [
        {
          type: err.name || "Error",
          value: message,
          mechanism: { handled: false, synthetic: false, type: context.mechanism ?? context.source },
          stacktrace: { type: "raw", frames: parseStack(stack) },
        },
      ],
      $process_person_profile: false,
      source: context.source,
      // The path without its query string: search terms and invite codes have
      // no business in an error report.
      path: context.path?.split("?")[0],
      digest: context.digest,
      method: context.method,
      route_path: context.routePath,
      route_type: context.routeType,
      router_kind: context.routerKind,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
    });
  } catch {
    // captureServer already swallows its own failures; this is belt and braces.
  }
}
