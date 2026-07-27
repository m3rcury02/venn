import { Poster } from "@/components/poster";

// SPEC §7 screen 6's reveal. Picks #2 and #3 stay ordinary MovieCards below;
// the hierarchy of "one winner, two runners-up" is carried by the treatment,
// not by a number in a badge.
//
// The frame is letterboxed on purpose -- black bars top and bottom, so the
// reveal reads as something being screened rather than a card in a grid.

type NightPickHeroProps = {
  title: string;
  year: number | null;
  /** Large art for the blurred backdrop. */
  backdropUrl: string | null;
  /** Sharp art for the foreground poster. */
  posterUrl: string | null;
  reasons: string[];
};

export function NightPickHero({
  title,
  year,
  backdropUrl,
  posterUrl,
  reasons,
}: NightPickHeroProps) {
  return (
    <section className="relative overflow-hidden rounded-card border border-hairline">
      {backdropUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
        <img
          src={backdropUrl}
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full scale-110 object-cover opacity-80 blur-2xl saturate-[2.1]"
        />
      ) : (
        // No poster: light the frame with the two beams instead of collapsing
        // the layout.
        <div
          aria-hidden
          className="absolute inset-0 opacity-45 blur-2xl"
          style={{
            background:
              "radial-gradient(60% 70% at 22% 30%, var(--beam-a), transparent 65%), radial-gradient(60% 70% at 78% 75%, var(--beam-b), transparent 65%)",
          }}
        />
      )}

      {/* Enough scrim to keep the title at AA over arbitrary poster art, and no
          more -- the point of the backdrop is that the film's own color reaches
          the page. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-t from-ink via-ink/75 to-ink/25"
      />

      {/* Letterbox. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-5 bg-ink sm:h-7" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-5 bg-ink sm:h-7" />

      <div className="relative flex flex-col gap-6 px-5 py-12 sm:flex-row sm:items-end sm:gap-8 sm:px-9 sm:py-16">
        <Poster
          src={posterUrl}
          alt={title}
          glow={false}
          markSize={40}
          className="w-32 shrink-0 sm:w-44"
        />

        <div className="min-w-0">
          <p className="t-label text-marquee">Tonight&rsquo;s pick</p>
          {/* Deliberately allowed to run past the frame -- the section clips it. */}
          <h2 className="t-display mt-3 -mr-6 text-[clamp(40px,12vw,96px)] text-fg">
            {title}
          </h2>
          {/* White, not `--fg-dim`. Measured off the rendered page: against the
              brightest pixel of a real blurred backdrop, `--fg-dim` came out
              4.36:1 -- under AA. Poster art is arbitrary, so the scrim cannot
              be relied on to hold a muted tone. Hierarchy here comes from the
              96px title, not from dimming the supporting lines. */}
          {year !== null ? <p className="t-label mt-4 text-fg">{year}</p> : null}

          {reasons.length > 0 ? (
            <ul className="mt-5 flex flex-col gap-1.5">
              {reasons.map((reason) => (
                <li key={reason} className="t-body text-[15px] text-fg">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="grain-art" aria-hidden />
    </section>
  );
}
