"use client";

import { useFormStatus } from "react-dom";
import { acceptInvite, dismissInvite } from "@/app/join/actions";
import { buttonClass } from "@/components/ui/button";

function JoinButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("marquee", "h-12 py-0")}>
      {pending ? "Joining…" : "Join the group"}
    </button>
  );
}

export function InviteAccept() {
  return (
    <div className="flex flex-wrap gap-3">
      <form action={acceptInvite}>
        <JoinButton />
      </form>
      <form action={dismissInvite}>
        <button type="submit" className={buttonClass("ghost", "h-12 py-0")}>
          Not now
        </button>
      </form>
    </div>
  );
}
