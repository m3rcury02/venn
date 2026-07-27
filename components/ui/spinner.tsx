// Was copy-pasted verbatim into three overlay buttons.
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={`h-3.5 w-3.5 rounded-full border-2 border-marquee/30 border-t-marquee motion-safe:animate-spin motion-reduce:animate-pulse ${className ?? ""}`}
    />
  );
}
