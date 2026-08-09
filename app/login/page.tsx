"use client";

import { useActionState, useEffect, useState } from "react";
import { motion, useReducedMotion, type Variants } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import { buttonClass } from "@/components/ui/button";
import { errorClass, inputClass } from "@/components/ui/input";
import { VennMark } from "@/components/venn-mark";
import { EASE_EXPOSE } from "@/lib/motion";
import { signIn, type LoginState } from "./actions";

const initialState: LoginState = {};

// The mark's own one-shot sweep (`mode="arrive"`) is plain CSS, timed by when
// it mounts, not by anything below -- delaying the mount is what times it
// into the sequence, so it fires once the beam wash has had time to land
// instead of racing it from the first frame.
const MARK_DELAY_MS = 520;

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
  const reduceMotion = useReducedMotion();

  const [showMark, setShowMark] = useState(false);
  useEffect(() => {
    if (reduceMotion) {
      // Same pattern as install-prompt.tsx and mobile-navigation.tsx:
      // revealing something whose presence depends on a browser API not
      // available during SSR.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowMark(true);
      return;
    }
    const timer = setTimeout(() => setShowMark(true), MARK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reduceMotion]);

  async function signInWithGoogle() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  // Letterbox in from the edges -- the house lights going down.
  const bar: Variants = reduceMotion
    ? {}
    : { hidden: { scaleY: 0 }, visible: { scaleY: 1, transition: { duration: 0.38, ease: EASE_EXPOSE } } };

  // The two beams arrive separately, `beamB` trailing `beamA` by ~120ms, and
  // only then read as overlapping rather than a single wash switched on.
  const beamStatic: Variants = { hidden: { opacity: 0.5 }, visible: { opacity: 0.5 } };
  const beamA: Variants = reduceMotion
    ? beamStatic
    : { hidden: { opacity: 0 }, visible: { opacity: 0.5, transition: { duration: 0.5, ease: EASE_EXPOSE, delay: 0.15 } } };
  const beamB: Variants = reduceMotion
    ? beamStatic
    : { hidden: { opacity: 0 }, visible: { opacity: 0.5, transition: { duration: 0.5, ease: EASE_EXPOSE, delay: 0.27 } } };

  // "VENN" rises once the mark has landed -- the exposure curve, same shape
  // as `@keyframes expose` in globals.css, just delayed into this sequence.
  const title: Variants = reduceMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.4, ease: "linear" } } }
    : {
        hidden: { opacity: 0, y: 10, scale: 0.985, filter: "brightness(0.35)" },
        visible: {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: "brightness(1)",
          transition: { duration: 0.5, ease: EASE_EXPOSE, delay: 0.85 },
        },
      };

  // Subtitle, Google button, divider, and the email form cascade in 60ms
  // apart, starting once the title has struck in.
  const cascadeContainer: Variants = reduceMotion
    ? { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.4, ease: "linear" } } }
    : { hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: 1.0 } } };
  const cascadeItem: Variants = reduceMotion
    ? {}
    : { hidden: { opacity: 0, y: 8 }, visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_EXPOSE } } };

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-5 py-14">
      {/* Two beams washing in from the edges, and the letterbox that frames
          them. The sign-in screen is the house lights going down. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 blur-3xl">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={beamA}
          className="absolute inset-0"
          style={{ background: "radial-gradient(45% 55% at 8% 22%, var(--beam-a), transparent 62%)" }}
        />
        <motion.div
          initial="hidden"
          animate="visible"
          variants={beamB}
          className="absolute inset-0"
          style={{ background: "radial-gradient(45% 55% at 92% 82%, var(--beam-b), transparent 62%)" }}
        />
      </div>
      <motion.div
        aria-hidden
        initial="hidden"
        animate="visible"
        variants={bar}
        style={{ transformOrigin: "top" }}
        className="absolute inset-x-0 top-0 h-6 bg-ink sm:h-9"
      />
      <motion.div
        aria-hidden
        initial="hidden"
        animate="visible"
        variants={bar}
        style={{ transformOrigin: "bottom" }}
        className="absolute inset-x-0 bottom-0 h-6 bg-ink sm:h-9"
      />

      <div className="w-full max-w-sm">
        {/* Fixed footprint the size of the mark (size=64 -> 16 * 4px), so its
            delayed mount below doesn't shift the title under it. */}
        <div className="h-16 w-16">{showMark ? <VennMark size={64} mode="arrive" /> : null}</div>
        <motion.h1
          initial="hidden"
          animate="visible"
          variants={title}
          className="t-display mt-6 text-[clamp(56px,17vw,88px)] text-fg"
        >
          Venn
        </motion.h1>

        <motion.div initial="hidden" animate="visible" variants={cascadeContainer}>
          <motion.p variants={cascadeItem} className="t-body mt-5 text-[15px] text-fg-dim">
            Sign in to see where your list overlaps with theirs.
          </motion.p>

          <motion.button
            variants={cascadeItem}
            type="button"
            onClick={signInWithGoogle}
            className={buttonClass("marquee", "mt-9 h-13 w-full")}
          >
            <GoogleIcon />
            Continue with Google
          </motion.button>

          <motion.div variants={cascadeItem} className="mt-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-hairline" />
            <span className="t-label text-fg-faint">or</span>
            <div className="h-px flex-1 bg-hairline" />
          </motion.div>

          {state.sent ? (
            <motion.p variants={cascadeItem} className="t-body mt-7 text-[15px] text-fg-dim">
              Check your email for a link to sign in.
            </motion.p>
          ) : (
            <motion.form
              variants={cascadeItem}
              action={formAction}
              className="mt-7 flex flex-col gap-3"
            >
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
            </motion.form>
          )}
        </motion.div>
      </div>
    </main>
  );
}
