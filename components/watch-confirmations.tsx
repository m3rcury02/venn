"use client";

import { useState, useTransition } from "react";
import { respondWatchConfirmation } from "@/app/groups/[id]/night/actions";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

export type PendingConfirmation = {
  nightId: string;
  movieTitle: string;
  groupName: string;
};

export function WatchConfirmations({
  confirmations,
}: {
  confirmations: PendingConfirmation[];
}) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const remaining = confirmations.filter((c) => !dismissedIds.has(c.nightId));
  if (remaining.length === 0) return null;

  const handleRespond = (nightId: string, status: "confirmed" | "declined") => {
    setDismissedIds((prev) => new Set(prev).add(nightId));
    startTransition(async () => {
      const res = await respondWatchConfirmation(nightId, status);
      if (!res.ok) {
        setDismissedIds((prev) => {
          const next = new Set(prev);
          next.delete(nightId);
          return next;
        });
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {remaining.map((item) => (
        <Panel key={item.nightId} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="t-body text-sm text-fg">
            Did you watch <strong className="text-fg-bright">{item.movieTitle}</strong> with{" "}
            <strong className="text-fg-bright">{item.groupName}</strong>?
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleRespond(item.nightId, "confirmed")}
              className={buttonClass("marquee", "h-8 py-0 px-4 text-xs")}
            >
              Yes
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleRespond(item.nightId, "declined")}
              className={buttonClass("ghost", "h-8 py-0 px-3 text-xs")}
            >
              Not yet
            </button>
          </div>
        </Panel>
      ))}
    </div>
  );
}
