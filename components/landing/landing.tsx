import Link from "next/link";
import type { ReactNode } from "react";
import { OverlapHero } from "@/components/landing/overlap-hero";
import { VoteDemo } from "@/components/landing/vote-demo";
import { buttonClass } from "@/components/ui/button";
import { VennMark } from "@/components/venn-mark";

// The signed-out front door at "/" (app/page.tsx renders this when there are
// no claims; lib/supabase/proxy.ts lets "/" through for exactly that case).
//
// Every claim on this page is something the app actually does today, in the
// recommender's own terms (SPEC §4): the 0.7 x lowest + 0.3 x average blend,
// the explanation strings, theatre mode, imports, share-to-app. Keep it that
// way -- a landing page that promises more than the product is the fastest
// way to lose the people it brings in.
//
// Contrast: there is light behind almost everything here (the hero's two
// beams, a glow behind each group of glass cards), so body text is white at
// 80%, never `--fg-dim`. Every glow outside a clipped card is capped at 50%
// opacity, which is what makes that safe -- scripted against each glow's
// peak, the beam colour at that opacity over black:
//
//   beam-a @ 0.5   white/80 6.44   marquee 7.1   | fg-dim 2.83
//   beam-b @ 0.5   white/80 5.07   marquee 5.4   | fg-dim 2.15
//
// The install card's 90% glow is clipped to the card and sits entirely
// under its glass, which computes its own worst case from pure white
// (globals.css, GLASS). The header bar carries `--fg-dim` links on the
// thick tier, which holds them at 4.73.

function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id?: string }) {
  return (
    <div id={id} className="scroll-mt-24">
      <p className="t-label text-marquee">{eyebrow}</p>
      <h2 className="t-display mt-4 text-[clamp(40px,9vw,80px)] text-fg">{title}</h2>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="scroll-reveal glass rounded-glass p-6">
      <p className="t-data text-[13px] text-marquee">{n}</p>
      <h3 className="t-section mt-3 text-[28px] text-fg">{title}</h3>
      <p className="t-body mt-3 text-[15px] leading-relaxed text-fg/80">{children}</p>
    </li>
  );
}

function Feature({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`scroll-reveal glass rounded-glass p-6 ${className ?? ""}`}>
      <h3 className="t-section text-[24px] text-fg">{title}</h3>
      <div className="t-body mt-3 text-[15px] leading-relaxed text-fg/80">{children}</div>
    </div>
  );
}

const PEOPLE = ["Asha", "Ben", "You"];

// One row of the "nobody objects" comparison: three people's scores for a
// film, and what each way of combining them makes of it.
function ScoreRow({ film, scores }: { film: string; scores: number[] }) {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const lowest = Math.min(...scores);
  const venn = 0.7 * lowest + 0.3 * mean;
  // Only a real outlier is lit: when everyone agrees, nobody is "least keen".
  const hasOutlier = lowest < Math.max(...scores);
  return (
    <div className="flex items-end justify-between gap-4 border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
      <div className="min-w-0">
        <p className="t-label text-fg">{film}</p>
        <p className="t-data mt-2 text-[13px] text-fg/80">
          <span className="sr-only">
            Scores {PEOPLE.map((name, i) => `${name} ${scores[i]}`).join(", ")}.{" "}
          </span>
          avg {mean.toFixed(2)}
        </p>
        <p className="t-data text-[13px] text-marquee">Venn {venn.toFixed(2)}</p>
      </div>
      <div className="flex shrink-0 items-end gap-3" aria-hidden>
        {scores.map((score, i) => (
          <div key={PEOPLE[i]} className="flex w-9 flex-col items-center gap-1.5">
            <div className="flex h-20 w-3 items-end overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className={`w-full rounded-full ${hasOutlier && score === lowest ? "bg-beam-a" : "bg-fg/85"}`}
                style={{ height: `${score * 100}%` }}
              />
            </div>
            <span className="text-[10px] tracking-[0.08em] text-fg/80 uppercase">{PEOPLE[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <main data-landing className="relative isolate flex flex-1 flex-col overflow-x-clip">
      {/* Two beams wandering behind the hero. Positioned toward the edges so
          they light the glass without sitting under the body copy. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[120vh] overflow-hidden"
      >
        <div
          className="absolute -top-[18%] -left-[28%] h-[85vh] w-[85vh] rounded-full opacity-50 blur-[100px] motion-safe:animate-drift-a"
          style={{ background: "radial-gradient(circle, var(--beam-a), transparent 66%)" }}
        />
        <div
          className="absolute top-[22%] -right-[30%] h-[90vh] w-[90vh] rounded-full opacity-45 blur-[110px] motion-safe:animate-drift-b"
          style={{ background: "radial-gradient(circle, var(--beam-b), transparent 66%)" }}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-ink" />
      </div>

      {/* Floating glass bar. Thick tier: it carries `--fg-dim` links. */}
      <header className="glass-thick sticky top-3 z-30 mx-3 mt-3 rounded-glass px-3 py-2 sm:mx-auto sm:w-[calc(100%-4rem)] sm:max-w-5xl">
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 px-1">
            <VennMark size={26} />
            <span className="t-display text-[26px] text-fg">Venn</span>
          </Link>
          <nav aria-label="Landing" className="flex items-center gap-1">
            <a
              href="#how"
              className="t-label hidden min-h-11 items-center rounded-lg px-3 text-fg-dim transition-colors hover:bg-white/[0.07] hover:text-fg sm:flex"
            >
              How it works
            </a>
            <a
              href="#features"
              className="t-label hidden min-h-11 items-center rounded-lg px-3 text-fg-dim transition-colors hover:bg-white/[0.07] hover:text-fg sm:flex"
            >
              Features
            </a>
            {/* Soft-cornered because it sits on the glass bar; the hero's
                CTAs below are on the plain ground and stay square. */}
            <Link
              href="/login"
              className={buttonClass("marquee", "h-11 rounded-xl px-4 text-[14px]")}
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-5xl items-center gap-14 px-5 pt-14 pb-20 sm:px-8 sm:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10 lg:pt-24 lg:pb-28">
        <div>
          <p className="t-label text-marquee motion-safe:animate-expose">
            Movie night, minus the argument
          </p>
          <h1 className="t-display mt-5 text-[clamp(68px,19vw,152px)] text-fg motion-safe:animate-expose motion-safe:[animation-delay:90ms]">
            Find the overlap
          </h1>
          <p className="t-body mt-7 max-w-md text-[17px] leading-7 text-fg/80 motion-safe:animate-expose motion-safe:[animation-delay:180ms]">
            Everyone keeps their own watchlist. When it&rsquo;s time to choose, Venn picks three
            films the whole room will enjoy, and tells you why.
          </p>
          <div className="mt-9 flex flex-wrap gap-3 motion-safe:animate-expose motion-safe:[animation-delay:260ms]">
            <Link href="/login" className={buttonClass("marquee", "h-13 px-7")}>
              Get started, it&rsquo;s free
            </Link>
            <a href="#how" className={buttonClass("ghost", "h-13 px-6")}>
              How it works
            </a>
          </div>
          <ul className="t-label mt-7 flex flex-wrap gap-x-5 gap-y-2.5 text-fg/80 motion-safe:animate-expose motion-safe:[animation-delay:340ms]">
            {["Movies & shows", "Groups of any size", "Installs from your browser"].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-marquee" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <OverlapHero />
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
        <SectionHeading id="how" eyebrow="How it works" title="Three taps to tonight's film" />
        <div className="relative mt-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-10 -inset-y-10 -z-10 opacity-50 blur-[80px]"
            style={{
              background:
                "radial-gradient(40% 60% at 15% 50%, var(--beam-a), transparent 70%), radial-gradient(40% 60% at 85% 50%, var(--beam-b), transparent 70%)",
            }}
          />
          <ol className="grid gap-4 md:grid-cols-3">
            <Step n="01" title="Keep a list">
              Add movies and shows from search, from a feed of trailers, or straight from Instagram
              or YouTube with your phone&rsquo;s share button.
            </Step>
            <Step n="02" title="Vote as you go">
              Rate what you&rsquo;ve seen: hated, liked, loved. Hype what you haven&rsquo;t. Every
              vote teaches Venn a little more about your taste.
            </Step>
            <Step n="03" title="Pick together">
              On movie night, tap who&rsquo;s here. Venn scores every film on your group&rsquo;s
              list for every person and hands you a top three, with reasons.
            </Step>
          </ol>
        </div>
      </section>

      {/* Nobody objects */}
      <section className="mx-auto grid w-full max-w-5xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="The scoring" title="Nobody quietly resents the pick" />
          <p className="t-body mt-6 max-w-md text-[16px] leading-7 text-fg/80">
            Averaging everyone&rsquo;s taste lets the most enthusiastic person win. Venn weights
            toward whoever is least keen: 70% the lowest score in the room, 30% the average. A film
            one of you would hate can&rsquo;t sneak through on the others&rsquo; votes.
          </p>
        </div>
        <div className="relative">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 scale-125 opacity-50 blur-[70px]"
            style={{
              background: "radial-gradient(60% 60% at 50% 50%, var(--beam-a), transparent 70%)",
            }}
          />
          <div className="scroll-reveal glass flex flex-col gap-4 rounded-glass p-6">
            <p className="t-label text-fg">Same average, different night</p>
            <ScoreRow film="Film A" scores={[0.7, 0.7, 0.7]} />
            <ScoreRow film="Film B" scores={[1, 1, 0.1]} />
            <p className="t-body text-[14px] leading-snug text-fg/80">
              Both average 0.70. An average can&rsquo;t tell them apart. Venn picks Film A, because
              someone in the room really doesn&rsquo;t want Film B.
            </p>
          </div>
        </div>
      </section>

      {/* Vote demo */}
      <section className="mx-auto grid w-full max-w-5xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-2">
        <div className="relative order-2 lg:order-1">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 scale-125 opacity-50 blur-[70px]"
            style={{
              background: "radial-gradient(60% 60% at 50% 50%, var(--beam-b), transparent 70%)",
            }}
          />
          <div className="scroll-reveal">
            <VoteDemo />
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <SectionHeading eyebrow="Try it" title="One tap per film" />
          <p className="t-body mt-6 max-w-md text-[16px] leading-7 text-fg/80">
            Seen it? Say how it landed. Not yet? Say how much you want to. That&rsquo;s the whole
            input. Venn works out the rest from the genres, cast, director and themes of what you
            rate.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
        <SectionHeading
          id="features"
          eyebrow="Everything else"
          title="Built for actual movie nights"
        />
        <div className="relative mt-12">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-10 -inset-y-10 -z-10 opacity-50 blur-[90px]"
            style={{
              background:
                "radial-gradient(35% 45% at 80% 20%, var(--beam-b), transparent 70%), radial-gradient(35% 45% at 20% 80%, var(--beam-a), transparent 70%)",
            }}
          />
          <div className="grid gap-4 md:grid-cols-6">
            <Feature title="Reasons, not a black box" className="md:col-span-4">
              <p>Every pick says why it&rsquo;s there.</p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {[
                  "All 4 of you are hyped for this",
                  "Matches: sci-fi, heist, mind-bending",
                  "Nobody here has seen it",
                ].map((reason) => (
                  <li
                    key={reason}
                    className="glass-highlight rounded-xl px-3 py-1.5 text-[14px] text-fg"
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            </Feature>
            <Feature title="Trailer feed" className="md:col-span-2">
              Not sure what you want? Scroll trailers one at a time and vote without leaving the
              feed.
            </Feature>
            <Feature title="Share from anywhere" className="md:col-span-2">
              Spotted a film on Instagram or YouTube? Share it to Venn and it lands on your list. On
              iPhone, a Shortcut does the same.
            </Feature>
            <Feature title="In cinemas this week" className="md:col-span-2">
              Theatre mode picks from what&rsquo;s showing and coming soon in your country, using
              the same scoring.
            </Feature>
            <Feature title="Remote nights" className="md:col-span-2">
              Not in the same room? Send a link. Whoever joins the lobby is in the pick.
            </Feature>
            <Feature title="Bring your history" className="md:col-span-3">
              Import your ratings and watchlist from Letterboxd or IMDb, so your first picks already
              know you.
            </Feature>
            <Feature title="Your data stays yours" className="md:col-span-3">
              Lists can be public, followers-only or private. Export everything or delete your
              account from Settings, any time.
            </Feature>
          </div>
        </div>
      </section>

      {/* Install */}
      <section className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="scroll-reveal relative overflow-hidden rounded-glass">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 opacity-90 blur-[50px]"
            style={{
              background:
                "radial-gradient(50% 80% at 0% 0%, var(--beam-a), transparent 70%), radial-gradient(50% 80% at 100% 100%, var(--beam-b), transparent 70%)",
            }}
          />
          <div className="glass grid gap-8 rounded-glass p-7 sm:p-10 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div>
              <p className="t-label text-marquee">No app store</p>
              <h2 className="t-display mt-4 text-[clamp(40px,8vw,72px)] text-fg">
                On your home screen in seconds
              </h2>
              <p className="t-body mt-5 max-w-md text-[16px] leading-7 text-fg/80">
                Venn runs in your browser and installs like an app, with its own icon and
                notifications for movie nights.
              </p>
            </div>
            <ol className="flex flex-col gap-3">
              <li className="glass-highlight rounded-xl p-4">
                <p className="t-label text-fg">iPhone</p>
                <p className="t-body mt-1.5 text-[15px] text-fg/80">
                  Open in Safari, tap Share, then Add to Home Screen.
                </p>
              </li>
              <li className="glass-highlight rounded-xl p-4">
                <p className="t-label text-fg">Android</p>
                <p className="t-body mt-1.5 text-[15px] text-fg/80">
                  Open in Chrome and tap Install when it asks.
                </p>
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* Final call */}
      <section className="relative mx-auto flex w-full max-w-5xl flex-col items-center px-5 pt-10 pb-28 text-center sm:px-8">
        <VennMark size={72} />
        <h2 className="t-display mt-8 text-[clamp(48px,12vw,112px)] text-fg">
          Tonight&rsquo;s sorted
        </h2>
        <p className="t-body mt-6 max-w-md text-[16px] leading-7 text-fg/80">
          Free, for anyone 18 or over. Sign in with Google or an email link, rate five films, and
          start a group.
        </p>
        <Link href="/login" className={buttonClass("marquee", "mt-9 h-13 px-8")}>
          Get started
        </Link>
      </section>
    </main>
  );
}
