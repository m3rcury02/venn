"use client";

import { useState, useActionState } from "react";
import { leaveGroup, type GroupFormState } from "@/app/groups/actions";
import { buttonClass } from "@/components/ui/button";
import { errorClass } from "@/components/ui/input";

const initialState: GroupFormState = {};

// The counterpart to DeleteGroupPanel: rendered for everyone who did not create
// the group, since group_members_delete_self refuses the owner. Same two-step
// shape, but deliberately quieter -- "Membership" rather than "Danger zone", and
// a ghost trigger rather than the beam fill -- because leaving is recoverable
// with the invite code and deleting is not.
export function LeaveGroupPanel({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState(leaveGroup, initialState);

  return (
    <section className="flex flex-col gap-3 rounded-card border border-hairline p-4">
      <h2 className="t-label text-fg-faint">Membership</h2>
      <p className="t-body text-[15px] text-fg-dim">
        Leaving removes you from the group. The list stays, and the movies you
        added stay on it. You&rsquo;ll need the invite code to rejoin.
      </p>

      {confirming ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={groupId} />
          <p className="t-body text-[15px] text-fg">
            Leave &ldquo;{groupName}&rdquo;?
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className={buttonClass("beam", "h-12 py-0")}
            >
              {pending ? "Leaving…" : "Leave"}
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
          className={buttonClass("ghost", "h-12 self-start py-0")}
        >
          Leave group
        </button>
      )}
    </section>
  );
}
