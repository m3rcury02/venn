import type { ReactNode } from "react";
import { VennMark } from "@/components/venn-mark";

type MovieCardProps = {
  title: string;
  year: number | null;
  posterUrl: string | null;
  children?: ReactNode;
  footer?: ReactNode;
};

export function MovieCard({ title, year, posterUrl, children, footer }: MovieCardProps) {
  return (
    <div className="group flex flex-col gap-2">
      <div className="relative">
        {/* Two blurred circles, hidden until hover -- the same overlap the
            wordmark draws, peeking from behind the poster's corners. */}
        <div className="pointer-events-none absolute -inset-3 -z-10 opacity-0 blur-xl transition-opacity duration-300 group-hover:opacity-50">
          <div className="absolute top-1 left-1 h-12 w-12 rounded-full bg-circle-a" />
          <div className="absolute top-1 right-1 h-12 w-12 rounded-full bg-circle-b" />
        </div>

        <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-surface shadow-sm ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-xl">
          {posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
            <img
              src={posterUrl}
              alt={title}
              className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-fg-faint">
              <VennMark size={28} />
            </div>
          )}

          {children ? (
            <div className="absolute top-2 right-2 z-10">{children}</div>
          ) : null}
        </div>
      </div>

      <div>
        <p className="truncate text-sm font-medium text-fg">{title}</p>
        <p className="font-mono text-xs text-fg-faint">{year ?? "—"}</p>
      </div>

      {footer ? <div>{footer}</div> : null}
    </div>
  );
}
