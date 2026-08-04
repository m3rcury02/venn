"use client";

import { useState, useTransition } from "react";
import { setGroupVisibility, type GroupVisibility } from "@/app/groups/actions";
import { errorClass } from "@/components/ui/input";

const OPTIONS: { value: GroupVisibility; label: string; description: string }[] = [
  {
    value: "invite",
    label: "Invite only",
    description: "Only people with the code can join. The group is not listed anywhere.",
  },
  {
    value: "public",
    label: "Anyone",
    description: "The group is listed in Discover and any signed-in user can join instantly.",
  },
];

export function GroupVisibilityPanel({
  groupId,
  current,
}: {
  groupId: string;
  current: GroupVisibility;
}) {
  const [selected, setSelected] = useState<GroupVisibility>(current);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleChange = (val: GroupVisibility) => {
    setSelected(val);
    setError(null);
    startTransition(async () => {
      const res = await setGroupVisibility(groupId, val);
      if (res.error) {
        setError(res.error);
        setSelected(current);
      }
    });
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="t-label text-fg-faint">Who can join</h2>
      <div className="flex flex-col gap-3">
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            className={`flex cursor-pointer items-start gap-3 rounded-ctl border p-4 transition ${
              selected === opt.value
                ? "border-fg-dim bg-surface-2"
                : "border-hairline bg-surface hover:border-fg-faint"
            }`}
          >
            <input
              type="radio"
              name="group_visibility"
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
    </section>
  );
}
