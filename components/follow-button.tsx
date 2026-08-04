"use client";

import { useState, useTransition } from "react";
import { followUser, unfollowUser } from "@/app/follows/actions";
import { buttonClass } from "@/components/ui/button";

export function FollowButton({
  targetUserId,
  isFollowingInitial,
}: {
  targetUserId: string;
  isFollowingInitial: boolean;
}) {
  const [isFollowing, setIsFollowing] = useState(isFollowingInitial);
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(async () => {
      if (isFollowing) {
        setIsFollowing(false);
        const res = await unfollowUser(targetUserId);
        if (!res.ok) setIsFollowing(true);
      } else {
        setIsFollowing(true);
        const res = await followUser(targetUserId);
        if (!res.ok) setIsFollowing(false);
      }
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={buttonClass(isFollowing ? "ghost" : "beam")}
    >
      {isPending ? "Updating…" : isFollowing ? "Following" : "Follow"}
    </button>
  );
}
