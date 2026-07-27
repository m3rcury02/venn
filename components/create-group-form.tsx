"use client";

import { useActionState } from "react";
import { createGroup, type GroupFormState } from "@/app/groups/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";

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
          className={`${inputClass} flex-1`}
        />
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("marquee", "h-12 shrink-0 py-0")}
        >
          {pending ? "Creating…" : "Create"}
        </button>
      </div>
      {state.error ? <p className={errorClass}>{state.error}</p> : null}
    </form>
  );
}
