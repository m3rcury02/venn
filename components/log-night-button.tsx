"use client";

import { useState, useTransition } from "react";
import { logNight } from "@/app/groups/[id]/night/actions";
import { buttonClass } from "@/components/ui/button";

export function LogNightButton({
  groupId,
  mode,
  movieId,
  present,
}: {
  groupId: string;
  mode: "home" | "theatre";
  movieId: string;
  present: string[];
}) {
  const [logged, setLogged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await logNight(groupId, mode, movieId, present);
      if (res.ok) {
        setLogged(true);
      } else {
        setError(res.error ?? "Failed to log movie night.");
      }
    });
  };

  if (logged) {
    return (
      <span className="t-label rounded-md border border-hairline bg-surface/50 px-4 py-2 text-sm text-fg-dim">
        Logged for tonight!
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-start">
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className={buttonClass("marquee", "py-2.5 px-5 text-sm")}
      >
        {isPending ? "Logging..." : "We're watching this"}
      </button>
      {error ? <p className="t-body text-xs text-beam-a">{error}</p> : null}
    </div>
  );
}
