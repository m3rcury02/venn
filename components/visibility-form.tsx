"use client";

import { useState, useTransition } from "react";
import { setListVisibility, type ListVisibility } from "@/app/settings/actions";
import { errorClass } from "@/components/ui/input";

const OPTIONS: { value: ListVisibility; label: string; description: string }[] = [
  {
    value: "public",
    label: "Everyone",
    description: "Any signed-in Venn user can view your list.",
  },
  {
    value: "followers",
    label: "People who follow you",
    description: "Only users who follow you can view your list.",
  },
  {
    value: "private",
    label: "Only you",
    description: "Nobody else can view your list.",
  },
];

export function VisibilityForm({ current }: { current: ListVisibility }) {
  const [selected, setSelected] = useState<ListVisibility>(current);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleChange = (val: ListVisibility) => {
    setSelected(val);
    setError(null);
    startTransition(async () => {
      const res = await setListVisibility(val);
      if (res.error) {
        setError(res.error);
        setSelected(current);
      }
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className={`flex cursor-pointer items-start gap-3 rounded-panel border p-4 transition ${
            selected === opt.value
              ? "border-fg-dim bg-surface-2"
              : "border-hairline bg-surface hover:border-fg-faint"
          }`}
        >
          <input
            type="radio"
            name="visibility"
            value={opt.value}
            checked={selected === opt.value}
            onChange={() => handleChange(opt.value)}
            disabled={isPending}
            className="mt-1 accent-beam-a"
          />
          <div className="flex flex-col gap-1">
            <span className="font-display text-[15px] font-medium text-fg">
              {opt.label}
            </span>
            <span className="t-body text-[14px] text-fg-dim">
              {opt.description}
            </span>
          </div>
        </label>
      ))}
      {error ? <p className={errorClass}>{error}</p> : null}
    </div>
  );
}
