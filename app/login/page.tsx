"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Venn</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Sign in with a magic link.
        </p>

        {state.sent ? (
          <p className="mt-6 text-sm">
            Check your email for a link to sign in.
          </p>
        ) : (
          <form action={formAction} className="mt-6 flex flex-col gap-3">
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="h-11 rounded-lg border border-zinc-300 px-3 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <button
              type="submit"
              disabled={pending}
              className="h-11 rounded-lg bg-zinc-900 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {pending ? "Sending…" : "Send magic link"}
            </button>
            {state.error ? (
              <p className="text-sm text-red-600">{state.error}</p>
            ) : null}
          </form>
        )}
      </div>
    </main>
  );
}
