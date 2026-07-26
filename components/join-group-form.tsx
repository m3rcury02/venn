"use client";

import { useActionState } from "react";
import { joinGroup, type GroupFormState } from "@/app/groups/actions";

const initialState: GroupFormState = {};

export function JoinGroupForm() {
  const [state, formAction, pending] = useActionState(joinGroup, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="text"
          name="code"
          required
          maxLength={16}
          placeholder="INVITE CODE"
          // join_group_by_code upper()s and trim()s, so casing here is cosmetic.
          className="h-11 min-w-0 flex-1 rounded-full bg-surface px-4 font-mono text-sm tracking-[0.2em] text-fg uppercase placeholder:tracking-normal placeholder:text-fg-faint focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-11 shrink-0 rounded-full bg-surface-strong px-5 text-sm font-medium text-fg transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
        >
          {pending ? "Joining…" : "Join"}
        </button>
      </div>
      {state.error ? (
        <p className="text-sm text-circle-a">{state.error}</p>
      ) : null}
    </form>
  );
}
