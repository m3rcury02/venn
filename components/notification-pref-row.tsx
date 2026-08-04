"use client";

import { useState, useTransition } from "react";
import { setNotificationPref } from "@/app/settings/notifications/actions";
import type { NotificationCategory } from "@/lib/notifications/categories";

export function NotificationPrefRow({
  category,
  label,
  initialPush,
  initialEmail,
  pushDisabled = false,
  pushDisabledCaption,
}: {
  category: NotificationCategory;
  label: string;
  initialPush: boolean;
  initialEmail: boolean;
  pushDisabled?: boolean;
  pushDisabledCaption?: string;
}) {
  const [push, setPush] = useState(initialPush);
  const [email, setEmail] = useState(initialEmail);
  const [isPending, startTransition] = useTransition();

  const handlePushChange = (newVal: boolean) => {
    setPush(newVal);
    startTransition(async () => {
      await setNotificationPref(category, newVal, email);
    });
  };

  const handleEmailChange = (newVal: boolean) => {
    setEmail(newVal);
    startTransition(async () => {
      await setNotificationPref(category, push, newVal);
    });
  };

  return (
    <div className="flex flex-col gap-1 border-b border-hairline pb-4 pt-2">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <span className="t-body text-sm text-fg font-medium">{label}</span>
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-fg-dim">
            <input
              type="checkbox"
              checked={push}
              disabled={pushDisabled || isPending}
              onChange={(e) => handlePushChange(e.target.checked)}
              className="accent-marquee h-4 w-4 rounded border-hairline bg-surface"
            />
            Push
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-xs text-fg-dim">
            <input
              type="checkbox"
              checked={email}
              disabled={isPending}
              onChange={(e) => handleEmailChange(e.target.checked)}
              className="accent-marquee h-4 w-4 rounded border-hairline bg-surface"
            />
            Email
          </label>
        </div>
      </div>
      {pushDisabledCaption ? (
        <p className="t-body text-xs text-fg-faint">{pushDisabledCaption}</p>
      ) : null}
    </div>
  );
}
