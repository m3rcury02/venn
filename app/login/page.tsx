"use client";

import { useActionState } from "react";
import { createClient } from "@/lib/supabase/client";
import { VennMark } from "@/components/venn-mark";
import { signIn, type LoginState } from "./actions";

const initialState: LoginState = {};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

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

        <button
          type="button"
          onClick={signInWithGoogle}
          className="mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-overlap font-medium text-overlap-fg transition-transform hover:scale-[1.02]"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="mt-6 flex items-center gap-3 text-xs text-fg-faint">
          <div className="h-px flex-1 bg-fg-faint/20" />
          or
          <div className="h-px flex-1 bg-fg-faint/20" />
        </div>

        {state.sent ? (
          <p className="mt-6 text-sm text-fg-muted">
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
              className="h-11 w-full rounded-full border border-fg-faint/20 bg-transparent px-5 text-sm text-fg-muted placeholder:text-fg-faint focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending}
              className="h-11 rounded-full border border-fg-faint/20 text-sm text-fg-muted transition-colors hover:bg-surface disabled:opacity-50"
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
