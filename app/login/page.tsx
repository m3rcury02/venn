"use client";

import { useActionState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";
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
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-5 py-14">
      {/* Two beams washing in from the edges, and the letterbox that frames
          them. The sign-in screen is the house lights going down. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-50 blur-3xl"
        style={{
          background:
            "radial-gradient(45% 55% at 8% 22%, var(--beam-a), transparent 62%), radial-gradient(45% 55% at 92% 82%, var(--beam-b), transparent 62%)",
        }}
      />
      <div aria-hidden className="absolute inset-x-0 top-0 h-6 bg-ink sm:h-9" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-6 bg-ink sm:h-9" />

      <div className="w-full max-w-sm">
        <VennMark size={64} animated />
        <h1 className="t-display mt-6 text-[clamp(56px,17vw,88px)] text-fg">Venn</h1>
        <p className="t-body mt-5 text-[15px] text-fg-dim">
          Sign in to see where your list overlaps with theirs.
        </p>

        <button
          type="button"
          onClick={signInWithGoogle}
          className={buttonClass("marquee", "mt-9 h-13 w-full")}
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="mt-7 flex items-center gap-3">
          <div className="h-px flex-1 bg-hairline" />
          <span className="t-label text-fg-faint">or</span>
          <div className="h-px flex-1 bg-hairline" />
        </div>

        {state.sent ? (
          <p className="t-body mt-7 text-[15px] text-fg-dim">
            Check your email for a link to sign in.
          </p>
        ) : (
          <form action={formAction} className="mt-7 flex flex-col gap-3">
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className={inputClass}
            />
            <button
              type="submit"
              disabled={pending}
              className={buttonClass("ghost", "h-12 py-0")}
            >
              {pending ? "Sending…" : "Send magic link"}
            </button>
            {state.error ? <p className={errorClass}>{state.error}</p> : null}
          </form>
        )}
      </div>
    </main>
  );
}
