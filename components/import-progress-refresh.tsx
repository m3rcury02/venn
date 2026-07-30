"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ImportProgressRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, 500);
    };

    const interval = setInterval(refresh, 1500);
    window.addEventListener("venn:import-progress", refresh);
    return () => {
      clearInterval(interval);
      if (timer) clearTimeout(timer);
      window.removeEventListener("venn:import-progress", refresh);
    };
  }, [active, router]);

  return null;
}
