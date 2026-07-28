"use client";

import { useState, useActionState } from "react";
import { deleteGroup, type GroupFormState } from "@/app/groups/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass } from "@/components/ui/input";

const initialState: GroupFormState = {};

// Only rendered for the group's creator (page checks created_by === caller);
// groups_delete_owner is the real gate. Two-step inline confirm, not a modal --
// the app's two <dialog> recipes exist to host navigation or two forms each,
// which a single destructive button doesn't need.
export function DeleteGroupPanel({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(deleteGroup, initialState);

  return (
    <section className="flex flex-col gap-3 rounded-card border border-hairline p-4">
      <h2 className="t-label text-fg-faint">Danger zone</h2>
      <p className="t-body text-[15px] text-fg-dim">
        Deleting removes the group and its list for everyone. This cannot be
        undone.
      </p>

      {confirming ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={groupId} />
          <p className="t-body text-[15px] text-fg">
            Delete &ldquo;{groupName}&rdquo; for everyone?
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className={buttonClass("beam", "h-12 py-0")}
            >
              {pending ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className={buttonClass("ghost", "h-12 py-0")}
            >
              Cancel
            </button>
          </div>
          {state.error ? <p className={errorClass}>{state.error}</p> : null}
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={buttonClass("beam", "h-12 self-start py-0")}
        >
          Delete group
        </button>
      )}
    </section>
  );
}
