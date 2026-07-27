import { VennMark } from "@/components/venn-mark";

// The mark, hunting. Every loading state in the app is this and nothing else --
// there is no generic spinner, because the app already owns a shape whose whole
// meaning is "two things trying to find their overlap", which is a better
// description of what Venn is doing while you wait than a rotating arc.
//
// `VennMark` is `aria-hidden`, so the announcement lives here: `role="status"`
// with `aria-live="polite"` means a screen reader says the label once when the
// loader appears and does not chatter while it stays.

type VennLoaderProps = {
  size?: number;
  /** Announced to screen readers. */
  label?: string;
  className?: string;
};

export function VennLoader({ size = 32, label = "Loading", className }: VennLoaderProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center justify-center ${className ?? ""}`}
    >
      {/* motion-reduce keeps the beams still and breathes the whole mark
          instead -- one slow opacity cycle, no positional movement. */}
      <VennMark size={size} mode="scan" className="motion-reduce:animate-breathe" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
