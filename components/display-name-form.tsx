"use client";

import { useActionState } from "react";
import { setDisplayName, type GroupFormState } from "@/app/groups/actions";

const initialState: GroupFormState = {};

export function DisplayNameForm({ current }: { current: string | null }) {
  const [state, formAction, pending] = useActionState(
    setDisplayName,
    initialState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label
        htmlFor="display_name"
        className="font-mono text-[11px] tracking-wider text-fg-faint uppercase"
      >
        You appear to groups as
      </label>
      <div className="flex gap-2">
        <input
          id="display_name"
          type="text"
          name="display_name"
          required
          maxLength={40}
          defaultValue={current ?? ""}
          placeholder="Member"
          className="h-11 min-w-0 flex-1 rounded-full bg-surface px-4 text-sm text-fg placeholder:text-fg-faint focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-11 shrink-0 rounded-full bg-surface-strong px-5 text-sm font-medium text-fg transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.error ? (
        <p className="text-sm text-circle-a">{state.error}</p>
      ) : null}
    </form>
  );
}
