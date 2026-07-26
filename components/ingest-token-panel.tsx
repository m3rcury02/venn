"use client";

import { useActionState } from "react";
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
  const [state, formAction, pending] = useActionState(
    createIngestToken,
    initialState,
  );

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
            className="h-11 min-w-0 flex-1 rounded-full bg-surface px-4 text-sm text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <button
            type="submit"
            disabled={pending}
            className="h-11 shrink-0 rounded-full bg-overlap px-5 text-sm font-medium text-overlap-fg transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
          >
            {pending ? "Creating…" : "Generate"}
          </button>
        </div>
        {state.error ? (
          <p className="text-sm text-circle-a">{state.error}</p>
        ) : null}
      </form>

      {/* Rendered here and nowhere else. This value exists only in the action's
          return; nothing on the server can show it again. */}
      {state.token ? (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4">
          <p className="font-mono text-[11px] tracking-wider text-fg-faint uppercase">
            Copy this now — it is not shown again
          </p>
          <code className="block wrap-anywhere rounded-xl bg-surface-strong p-3 font-mono text-xs text-fg select-all">
            {state.token}
          </code>
        </div>
      ) : null}

      {tokens.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">
                  {token.label ?? "Unnamed"}
                </p>
                <p className="font-mono text-[10px] tracking-wider text-fg-faint uppercase">
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
  const [, formAction, pending] = useActionState(
    revokeIngestToken,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="shrink-0 rounded-full px-3 py-1.5 font-mono text-[10px] tracking-wider text-fg-faint uppercase transition-colors hover:bg-surface-strong hover:text-circle-a disabled:opacity-50"
      >
        {pending ? "…" : "Revoke"}
      </button>
    </form>
  );
}
