"use client";

import { useActionState } from "react";
import { joinGroup, type GroupFormState } from "@/app/groups/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";

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
          // Genuinely machine-read text, so this is one of the three places the
          // system monospace stack is used rather than Archivo -- an invite code
          // has to survive being read aloud and retyped.
          // join_group_by_code upper()s and trim()s, so casing here is cosmetic.
          className={`${inputClass} flex-1 font-mono tracking-[0.2em] uppercase placeholder:tracking-normal`}
        />
        <button
          type="submit"
          disabled={pending}
          className={buttonClass("ghost", "h-12 shrink-0 py-0")}
        >
          {pending ? "Joining…" : "Join"}
        </button>
      </div>
      {state.error ? <p className={errorClass}>{state.error}</p> : null}
    </form>
  );
}
