"use client";

import { useState, useTransition } from "react";
import { blockUser, unblockUser } from "@/app/follows/actions";
import { buttonClass } from "@/components/ui/button";

export function BlockButton({
  targetUserId,
  isBlockedInitial,
}: {
  targetUserId: string;
  isBlockedInitial: boolean;
}) {
  const [isBlocked, setIsBlocked] = useState(isBlockedInitial);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(async () => {
      if (isBlocked) {
        setIsBlocked(false);
        const res = await unblockUser(targetUserId);
        if (!res.ok) setIsBlocked(true);
      } else {
        setIsBlocked(true);
        const res = await blockUser(targetUserId);
        if (!res.ok) setIsBlocked(false);
      }
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={buttonClass("ghost")}
    >
      {isPending ? "Updating…" : isBlocked ? "Unblock" : "Block"}
    </button>
  );
}
