// The one signature element the app is built around: two circles, offset
// just enough to overlap. It's the wordmark, and -- played once, sliding in
// from opposite sides -- the "this movie just joined your list" moment in
// AddToListButton. Same glyph, same idea, in both places on purpose.

type VennMarkProps = {
  size?: number;
  /** Plays the two circles sliding together, instead of rendering settled. */
  animated?: boolean;
  className?: string;
};

export function VennMark({ size = 20, animated = false, className }: VennMarkProps) {
  const circle = Math.round(size * 0.62);
  const offset = Math.round(size * 0.19);

  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <span
        className={`absolute rounded-full bg-circle-a ${animated ? "motion-safe:animate-venn-slide-a" : ""}`}
        style={{ width: circle, height: circle, left: 0, top: offset }}
      />
      <span
        className={`absolute rounded-full bg-circle-b opacity-75 ${animated ? "motion-safe:animate-venn-slide-b" : ""}`}
        style={{ width: circle, height: circle, right: 0, top: offset }}
      />
    </span>
  );
}
