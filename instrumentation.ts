import type { Instrumentation } from "next";

// Every uncaught error in a server render, route handler, server action or the
// proxy lands here (Next's onRequestError hook). Until this file existed they
// reached Vercel's runtime logs and nowhere else, which on the Hobby plan keep
// an hour of history and alert nobody. See lib/errors/report.ts.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  // Imported lazily: this module is also loaded for the edge runtime, and the
  // reporter only needs to exist once an error actually happens.
  const { reportError } = await import("./lib/errors/report");
  await reportError(error, {
    source: "server",
    path: request.path,
    method: request.method,
    // Matches the code the error page shows the user ("Reel break"), so a
    // screenshot from a user finds its report.
    digest: (error as { digest?: string } | null)?.digest,
    routePath: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
  });
};
