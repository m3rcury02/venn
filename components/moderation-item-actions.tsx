"use client";

import { useTransition } from "react";
import {
  deleteReportedAccount,
  deleteReportedContent,
  dismissReport,
} from "@/app/moderation/actions";
import { buttonClass } from "@/components/ui/button";

export function ModerationItemActions({
  reportId,
  targetType,
}: {
  reportId: string;
  targetType: "user" | "list" | "list_item";
}) {
  const [isPending, startTransition] = useTransition();

  const handleDismiss = () => {
    startTransition(async () => {
      await dismissReport(reportId);
    });
  };

  const handleDeleteContent = () => {
    startTransition(async () => {
      await deleteReportedContent(reportId);
    });
  };

  const handleDeleteAccount = () => {
    startTransition(async () => {
      await deleteReportedAccount(reportId);
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={handleDismiss}
        className={buttonClass("ghost", "h-8 py-0 px-3 text-xs")}
      >
        Dismiss
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={handleDeleteContent}
        className={buttonClass("marquee", "h-8 py-0 px-3 text-xs")}
      >
        Delete Content
      </button>
      {targetType === "user" ? (
        <button
          type="button"
          disabled={isPending}
          onClick={handleDeleteAccount}
          className={buttonClass("ghost", "h-8 py-0 px-3 text-xs text-beam-a")}
        >
          Delete Account
        </button>
      ) : null}
    </div>
  );
}
