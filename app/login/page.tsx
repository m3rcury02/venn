"use client";

import { useActionState } from "react";
import { VennMark } from "@/components/venn-mark";
import { signIn, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2">
          <VennMark size={26} />
          <h1 className="text-2xl font-semibold tracking-tight text-fg">
            Venn
          </h1>
        </div>
        <p className="mt-2 text-sm text-fg-muted">
          Sign in to see where your list overlaps with theirs.
        </p>

        {state.sent ? (
          <p className="mt-8 text-sm text-fg">
            Check your email for a link to sign in.
          </p>
        ) : (
          <form action={formAction} className="mt-8 flex flex-col gap-4">
            <div
              className="rounded-full p-[1.5px] transition-shadow focus-within:shadow-md"
              style={{
                background:
                  "linear-gradient(to right, var(--circle-a), var(--circle-b))",
              }}
            >
              <div className="rounded-full bg-bg">
                <input
                  type="email"
                  name="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="h-12 w-full rounded-full bg-transparent px-5 text-fg placeholder:text-fg-faint focus:outline-none"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={pending}
              className="h-12 rounded-full bg-overlap font-medium text-overlap-fg transition-transform hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
            >
              {pending ? "Sending…" : "Send magic link"}
            </button>
            {state.error ? (
              <p className="text-sm text-circle-a">{state.error}</p>
            ) : null}
          </form>
        )}
      </div>
    </main>
  );
}
