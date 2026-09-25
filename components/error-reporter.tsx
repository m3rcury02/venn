"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/errors/client";

// Errors no error boundary sees: thrown in event handlers, timers, and
// promises nobody awaited. Render errors are reported by app/error.tsx and
// app/global-error.tsx instead, because React hands those to the boundary
// rather than to window.onerror.
export function ErrorReporter() {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      // A cross-origin script's error arrives as "Script error." with no
      // detail at all, and extensions inject scripts into every page. Neither
      // is Venn's bug, and neither can be acted on.
      if (!event.error && event.message === "Script error.") return;
      if (/^(chrome|moz|safari(-web)?)-extension:/.test(event.filename ?? "")) return;
      reportClientError(event.error ?? event.message, "window.onerror");
    }

    function onRejection(event: PromiseRejectionEvent) {
      reportClientError(event.reason, "unhandledrejection");
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
