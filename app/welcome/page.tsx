import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Reveal } from "@/components/ui/reveal";
import { VennMark } from "@/components/venn-mark";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Venn: pick a movie nobody hates",
  alternates: { canonical: "/welcome" },
};

// The signed-out front door: lib/supabase/proxy.ts sends a signed-out visitor
// to / here, and an invite link followed while signed out arrives with
// ?invite=1. Everything on it is something the app actually does -- the
// reasons in the sample are the exact strings lib/recommend/explain.ts
// writes, and "leans toward the least happy person" is SPEC §4.3's
// `0.7 × min + 0.3 × mean`. No poster art: TMDB images are licensed for
// showing a title's own entry, not for marketing the app around them.

const STEPS = [
  {
    title: "Rate five films",
    body: "Love, like or hate a few films you've seen. That's enough for Venn to learn your taste. Years of ratings on Letterboxd or IMDb? Import them.",
  },
  {
    title: "Start a group",
    body: "Make a group for the people you watch with and send them the link. Anything anyone adds goes into the group's list.",
  },
  {
    title: "Tick who's there",
    body: "On the night, mark who's on the couch. Venn scores every film for every person, drops anything someone there has already seen, and leans toward the film the least happy person still likes.",
  },
];

const FEATURES = [
  {
    title: "Going out instead",
    body: "Theatre mode picks from what's in cinemas in your country, and what opens soon.",
  },
  {
    title: "Not in the same room",
    body: "Start a lobby and send the group the link. Everyone taps in from their own phone, and the picks count whoever joined.",
  },
  {
    title: "Saw it on Instagram",
    body: "Share a post or a trailer to Venn and the film lands on your list. If Venn can't tell which film it is, it waits in your inbox for you to pick. Android shares from the share menu; iPhone uses a Shortcut.",
  },
  {
    title: "Nothing in mind",
    body: "Explore is a feed of trailers, one film a screen. Vote as you scroll and Venn learns your taste from it.",
  },
];

// The dots are the mark's own two beams and the white where they overlap.
const SAMPLE_REASONS = [
  { dot: "bg-beam-a", text: "All 4 of you are hyped for this" },
  { dot: "bg-beam-b", text: "3 of 4 love Christopher Nolan" },
  { dot: "bg-fg", text: "Nobody here has seen it" },
];

type WelcomeProps = {
  searchParams: Promise<{ invite?: string }>;
};

export default async function WelcomePage({ searchParams }: WelcomeProps) {
  // Public, so the proxy doesn't gate it. Someone already signed in has no use
  // for a sign-up pitch.
  const supabase = await createClient();
  const { data } = await getClaims(supabase);
  if (data?.claims) redirect("/");

  const invited = (await searchParams).invite === "1";

  return (
    <main className="relative flex-1 overflow-hidden">
      {/* The login page's two beams, faded out at the bottom: this page scrolls,
          and a bounded blur otherwise ends in a hard edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[900px] opacity-50 blur-3xl [mask-image:linear-gradient(to_bottom,#000_45%,transparent)]"
      >
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(40% 50% at 10% 20%, var(--beam-a), transparent 62%)" }}
        />
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(40% 50% at 90% 45%, var(--beam-b), transparent 62%)" }}
        />
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-5 py-8 sm:gap-24 sm:px-8 sm:py-12">
        <header className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2.5">
            <VennMark size={26} />
            <span className="t-display text-[26px] text-fg">Venn</span>
          </span>
          <Link href="/login" className={buttonClass("ghost", "h-11 py-0")}>
            Sign in
          </Link>
        </header>

        <section className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl motion-safe:animate-expose">
            {invited ? (
              <p className="t-body mb-8 rounded-card border border-marquee px-4 py-3 text-[15px] text-fg">
                You&apos;ve been invited to a group. Sign in and you&apos;ll be asked to join it.
                New here? That comes right after you rate your first five films.
              </p>
            ) : null}
            {/* t-display's 0.82 leading is set for one-line titles; this one
                wraps, and at 0.82 Anton's caps collide line to line. */}
            <h1 className="t-display text-[clamp(56px,15vw,128px)] leading-[0.92] text-fg">
              Pick a movie nobody hates
            </h1>
            <p className="t-body mt-6 max-w-xl text-[17px] leading-relaxed text-fg-dim">
              Everyone rates a few films. On movie night, tick who&apos;s there and Venn suggests
              three picks the whole room will sit through, with the reason for each.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/login" className={buttonClass("marquee", "h-13 px-7")}>
                {invited ? "Sign in to join" : "Get started"}
              </Link>
              <a href="#how" className={buttonClass("ghost", "h-13 px-7")}>
                How it works
              </a>
            </div>
            <p className="t-label mt-5 text-fg-faint">Free · 18+ · Runs in your browser</p>
          </div>

          <Panel className="w-full max-w-sm shrink-0 p-5 motion-safe:animate-expose">
            <p className="t-label text-fg-faint">Tonight&apos;s top pick · 4 on the couch</p>
            <ul className="mt-4 flex flex-col gap-3">
              {SAMPLE_REASONS.map((reason) => (
                <li key={reason.text} className="t-body flex items-center gap-3 text-[15px] text-fg">
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${reason.dot}`} />
                  {reason.text}
                </li>
              ))}
            </ul>
            <p className="t-body mt-5 border-t border-hairline pt-4 text-[13px] text-fg-dim">
              Every pick comes with its reasons, so nobody has to argue for it.
            </p>
          </Panel>
        </section>

        <section id="how" className="scroll-mt-8">
          <Reveal>
            <h2 className="t-section text-[clamp(32px,7vw,48px)] text-fg">How it works</h2>
          </Reveal>
          <ol className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <Reveal index={i} className="h-full">
                  <Panel className="h-full p-5">
                    <p className="t-data text-[13px] text-marquee">0{i + 1}</p>
                    <h3 className="t-section mt-3 text-[22px] text-fg">{step.title}</h3>
                    <p className="t-body mt-3 text-[15px] text-fg-dim">{step.body}</p>
                  </Panel>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        <section>
          <Reveal>
            <h2 className="t-section text-[clamp(32px,7vw,48px)] text-fg">Also in the box</h2>
          </Reveal>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {FEATURES.map((feature, i) => (
              <Reveal key={feature.title} index={i} className="h-full">
                <Panel className="h-full p-5">
                  <h3 className="t-section text-[20px] text-fg">{feature.title}</h3>
                  <p className="t-body mt-3 text-[15px] text-fg-dim">{feature.body}</p>
                </Panel>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="flex flex-col items-start gap-6 border-t border-hairline pt-12">
          <h2 className="t-section text-[clamp(32px,7vw,48px)] text-fg">
            Stop scrolling. Start the film.
          </h2>
          <Link href="/login" className={buttonClass("marquee", "h-13 px-7")}>
            {invited ? "Sign in to join" : "Get started"}
          </Link>
        </section>
      </div>
    </main>
  );
}
