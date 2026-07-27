// A cinema marquee: the names of whoever is watching tonight, scrolling.
//
// The track holds the sequence twice and translates by exactly -50%, so the
// second copy is under the cursor at the moment the first one leaves -- the
// loop has no seam. `.ticker-track` is pinned in globals.css so
// prefers-reduced-motion halts it outright rather than merely shortening it.
export function Ticker({ items }: { items: string[] }) {
  if (items.length === 0) return null;

  // A short list (one member present) leaves the track narrower than the
  // viewport, so translating -50% would drag visible empty space across the
  // screen. Pad the sequence out first, then duplicate it.
  const filled: string[] = [];
  while (filled.length < 8) filled.push(...items);

  return (
    <div
      className="relative overflow-hidden border-y border-hairline py-3"
      aria-hidden
    >
      <div className="ticker-track flex w-max motion-safe:animate-ticker">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0">
            {filled.map((item, i) => (
              <span
                key={`${copy}-${i}`}
                className="t-display flex items-center gap-5 px-5 text-[15px] text-fg-dim"
              >
                {item}
                <span className="text-marquee">&bull;</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
