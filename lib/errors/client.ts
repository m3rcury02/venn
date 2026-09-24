// Browser half of error tracking (lib/errors/report.ts is the server half).
// Posts to /api/errors, which forwards to PostHog server-side: the browser
// never talks to PostHog for this, so an error report needs no analytics
// consent and carries no client IP to PostHog.

const MAX_REPORTS_PER_PAGE = 5;
const MAX_FIELD = 4000;

let sent = 0;
const seen = new Set<string>();

function sessionId(): string | undefined {
  try {
    let id = sessionStorage.getItem("venn_error_session");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("venn_error_session", id);
    }
    return id;
  } catch {
    return undefined;
  }
}

/**
 * Reports one browser-side error. At most five per page load, and each
 * distinct error once: a render loop throwing on every frame would otherwise
 * be thousands of identical reports.
 */
export function reportClientError(error: unknown, mechanism: string, digest?: string): void {
  if (sent >= MAX_REPORTS_PER_PAGE) return;

  const err = error instanceof Error ? error : new Error(String(error));
  const signature = `${err.name}:${err.message}:${err.stack?.split("\n")[1] ?? ""}`;
  if (seen.has(signature)) return;
  seen.add(signature);
  sent += 1;

  const body = JSON.stringify({
    name: err.name.slice(0, 200),
    message: err.message.slice(0, MAX_FIELD),
    stack: (err.stack ?? "").slice(0, MAX_FIELD),
    path: window.location.pathname,
    digest,
    mechanism,
    sessionId: sessionId(),
  });

  // keepalive: an error right before a navigation should still arrive.
  fetch("/api/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {
    // Nowhere left to report a failure to report.
  });
}
