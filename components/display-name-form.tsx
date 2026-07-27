"use client";

import { useActionState } from "react";
import { setDisplayName, type GroupFormState } from "@/app/groups/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";
import { labelClass } from "@/components/ui/label";

const initialState: GroupFormState = {};

export function DisplayNameForm({ current }: { current: string | null }) {
  const [state, formAction, pending] = useActionState(setDisplayName, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2.5">
      <label htmlFor="display_name" className={labelClass}>
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
          className={`${inputClass} flex-1`}
        />
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("ghost", "h-12 shrink-0 py-0")}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.error ? <p className={errorClass}>{state.error}</p> : null}
    </form>
  );
}
