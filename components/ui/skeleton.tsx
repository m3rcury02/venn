import { Screen } from "@/components/ui/screen";
import { VennLoader } from "@/components/venn-loader";

// Skeletons exist to hold the shape, so the real content does not shove the
// page around when it lands. They are deliberately dumb blocks: the *activity*
// is signalled once, by the loader in the header, rather than by twenty
// separately shimmering tiles.

function Block({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`rounded-card bg-surface-2 motion-safe:animate-breathe ${className ?? ""}`}
    />
  );
}

function PosterGrid({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2.5">
          <Block className="aspect-[2/3]" />
          <Block className="h-3.5 w-3/4" />
          <Block className="h-2.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

function Rows({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <Block key={i} className="h-16" />
      ))}
    </div>
  );
}

/**
 * The shared body of every `loading.tsx`. Mirrors the real screen's rhythm --
 * header row, display heading, then content -- so the swap is a fill-in rather
 * than a relayout.
 */
export function ScreenLoading({
  variant = "grid",
  width = "wide",
}: {
  variant?: "grid" | "rows" | "plain";
  width?: "wide" | "narrow";
}) {
  return (
    <Screen width={width}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Block className="h-7 w-32" />
          <Block className="h-2.5 w-20" />
        </div>
        <VennLoader size={30} label="Loading page" />
      </div>

      <Block className="h-[clamp(44px,13vw,96px)] w-2/3 max-w-md" />

      {variant === "grid" ? <PosterGrid /> : null}
      {variant === "rows" ? <Rows /> : null}
    </Screen>
  );
}
