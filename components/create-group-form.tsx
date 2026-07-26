"use client";

import { useActionState } from "react";
import { createGroup, type GroupFormState } from "@/app/groups/actions";

const initialState: GroupFormState = {};

export function CreateGroupForm() {
  const [state, formAction, pending] = useActionState(createGroup, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="text"
          name="name"
          required
          maxLength={60}
          placeholder="Friday Night Crew"
          className="h-11 min-w-0 flex-1 rounded-full bg-surface px-4 text-sm text-fg placeholder:text-fg-faint focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-11 shrink-0 rounded-full bg-overlap px-5 text-sm font-medium text-overlap-fg transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </div>
      {state.error ? (
        <p className="text-sm text-circle-a">{state.error}</p>
      ) : null}
    </form>
  );
}
