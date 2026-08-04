"use client";

import { useState, useTransition } from "react";
import { joinPublicGroup } from "@/app/groups/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass } from "@/components/ui/input";

export function JoinPublicGroupButton({ groupId }: { groupId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleJoin = () => {
    setError(null);
    startTransition(async () => {
      const res = await joinPublicGroup(groupId);
      if (res?.error) {
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleJoin}
        disabled={isPending}
        className={buttonClass("marquee")}
      >
        {isPending ? "Joining…" : "Join"}
      </button>
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
