"use client";

import { useState, useTransition } from "react";
import { submitReport, type TargetType } from "@/app/reports/actions";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";

export function ReportButton({
  targetType,
  targetId,
  label = "Report",
  className,
}: {
  targetType: TargetType;
  targetId: string;
  label?: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (isReported) {
    return <span className="t-label text-xs text-fg-faint">Reported</span>;
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={className ?? buttonClass("ghost")}
      >
        {label}
      </button>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError("Please state a reason for the report.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const res = await submitReport(targetType, targetId, reason);
      if (res.ok) {
        setIsReported(true);
        setIsOpen(false);
      } else {
        setError(res.error ?? "Failed to submit report.");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2 max-w-sm text-left">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for report..."
        maxLength={1000}
        rows={2}
        required
        className={`${inputClass} resize-none text-xs`}
      />
      {error ? <p className="t-body text-xs text-beam-a">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isPending}
          className={buttonClass("marquee", "h-8 py-0 px-3 text-xs")}
        >
          {isPending ? "Submitting..." : "Submit Report"}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            setError(null);
          }}
          disabled={isPending}
          className={buttonClass("ghost", "h-8 py-0 px-3 text-xs")}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
