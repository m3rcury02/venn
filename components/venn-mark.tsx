// Two projector beams, overlapping.
//
// The overlap is not a chosen color. Both circles composite with
// `mix-blend-mode: plus-lighter`, which adds channel-wise and clamps, so where
// they cross the GPU computes:
//
//     #FF2D6F + #00E5FF = (255, 274->255, 366->255) = #FFFFFF
//
// Pure white -- the blown-out center of two beams landing on the same spot.
// The previous version faked its overlap with a clip-path and a hand-picked
// third hex; this one has no third color in it at all.
//
// Two constraints follow, and both are real:
//
//   * The wrapper MUST isolate. Without `isolation: isolate` the blend reaches
//     past the mark and adds itself to whatever is behind it on the page.
//   * The mark only reads on the black ground. Never place it on a `--marquee`
//     or `--beam-*` fill -- additive light on a bright backdrop clips to white
//     everywhere and the mark vanishes.
//
// Browsers without `plus-lighter` (pre-2023) degrade to `normal`: circle-b
// simply sits on top of circle-a. Legible, just not the point.

type VennMarkProps = {
  size?: number;
  /** Plays the beam sweep once. The "joined your list" moment. */
  animated?: boolean;
  className?: string;
};

export function VennMark({ size = 20, animated = false, className }: VennMarkProps) {
  // 0.55 was measured, not picked: rendered at 22/30/40/96px against 0.52,
  // 0.58, 0.61 and 0.64. Above ~0.58 the white lens swallows both beams and
  // the mark reads as one blob; below ~0.52 the lens disappears at 22px.
  const circle = Math.round(size * 0.55);
  const top = Math.round((size - circle) / 2);
  // Two circles of width `circle` spanning a box of width `size` cross by
  // exactly this much.
  const overlap = 2 * circle - size;

  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 isolate ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <span
        className={`absolute rounded-full ${animated ? "motion-safe:animate-beam-a" : ""}`}
        style={{
          width: circle,
          height: circle,
          left: 0,
          top,
          background: "var(--beam-a)",
          mixBlendMode: "plus-lighter",
        }}
      />
      <span
        className={`absolute rounded-full ${animated ? "motion-safe:animate-beam-b" : ""}`}
        style={{
          width: circle,
          height: circle,
          right: 0,
          top,
          background: "var(--beam-b)",
          mixBlendMode: "plus-lighter",
        }}
      />
      {animated ? (
        <span
          className="absolute rounded-full motion-safe:animate-beam-flash motion-reduce:hidden"
          style={{
            width: overlap * 2.6,
            height: overlap * 2.6,
            left: size / 2 - overlap * 1.3,
            top: size / 2 - overlap * 1.3,
            background:
              "radial-gradient(circle, rgba(255,255,255,.95) 0%, rgba(255,255,255,0) 70%)",
            mixBlendMode: "plus-lighter",
          }}
        />
      ) : null}
    </span>
  );
}
