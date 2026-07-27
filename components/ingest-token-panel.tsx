"use client";

import { useActionState } from "react";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import {
  createIngestToken,
  revokeIngestToken,
  type TokenFormState,
} from "@/app/settings/actions";

export type TokenRow = {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const initialState: TokenFormState = {};

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "never";
}

export function IngestTokenPanel({ tokens }: { tokens: TokenRow[] }) {
  const [state, formAction, pending] = useActionState(createIngestToken, initialState);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input
            type="text"
            name="label"
            required
            maxLength={40}
            placeholder="My iPhone"
            className={`${inputClass} flex-1`}
          />
          <button
            type="submit"
            disabled={pending}
            className={buttonClass("marquee", "h-12 shrink-0 py-0")}
          >
            {pending ? "Creating…" : "Generate"}
          </button>
        </div>
        {state.error ? <p className={errorClass}>{state.error}</p> : null}
      </form>

      {/* Rendered here and nowhere else. This value exists only in the action's
          return; nothing on the server can show it again. */}
      {state.token ? (
        <Panel className="flex flex-col gap-2.5 border-marquee/40">
          <p className="t-label text-marquee">Copy this now — it is not shown again</p>
          <code className="block wrap-anywhere rounded-ctl bg-surface-2 p-3 font-mono text-[13px] text-fg select-all">
            {state.token}
          </code>
        </Panel>
      ) : null}

      {tokens.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-fg">{token.label ?? "Unnamed"}</p>
                <p className="t-label mt-1 text-fg-faint">
                  {token.revoked_at
                    ? `Revoked ${when(token.revoked_at)}`
                    : `Last used ${when(token.last_used_at)}`}
                </p>
              </div>
              {token.revoked_at ? null : <RevokeButton id={token.id} />}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RevokeButton({ id }: { id: string }) {
  const [, formAction, pending] = useActionState(revokeIngestToken, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="t-label shrink-0 rounded-ctl px-3 py-2 text-fg-faint transition-colors hover:bg-surface-2 hover:text-beam-a disabled:opacity-50"
      >
        {pending ? "…" : "Revoke"}
      </button>
    </form>
  );
}
