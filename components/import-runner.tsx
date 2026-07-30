"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const EXCLUDED_PATHS = ["/login", "/auth", "/onboarding", "/offline"];

/**
 * A durable, cooperative background runner. It processes one row per request
 * while any authenticated app screen is open and resumes on the next session.
 */
export function ImportRunner() {
  const pathname = usePathname();
  const [supabase] = useState(createClient);

  useEffect(() => {
    if (EXCLUDED_PATHS.some((path) => pathname.startsWith(path))) return;

    let cancelled = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled || running) return;
      running = true;

      try {
        const { data: job } = await supabase
          .from("imports")
          .select("id")
          .eq("status", "processing")
          .order("created_at")
          .limit(1)
          .maybeSingle();

        if (!job || cancelled) return;

        const response = await fetch(`/api/imports/${job.id}/process`, {
          method: "POST",
        });
        if (!response.ok) throw new Error("import processor failed");
        const result = (await response.json()) as { status?: string };

        window.dispatchEvent(new CustomEvent("venn:import-progress"));
        if (!cancelled && result.status === "processing") {
          timer = setTimeout(tick, 250);
        } else if (!cancelled) {
          timer = setTimeout(tick, 0);
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 3000);
      } finally {
        running = false;
      }
    }

    function start() {
      if (timer) clearTimeout(timer);
      timer = null;
      void tick();
    }

    window.addEventListener("venn:import-started", start);
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("venn:import-started", start);
    };
  }, [pathname, supabase]);

  return null;
}
