import type { ReactNode } from "react";
import { Poster } from "@/components/poster";

type MovieCardProps = {
  title: string;
  year: number | null;
  posterUrl: string | null;
  children?: ReactNode;
  footer?: ReactNode;
};

// Titles stay in Archivo, not Anton. A grid of twenty cards set in the display
// face is noise -- Anton earns its keep on headings and the night hero, where
// there is one of it.
export function MovieCard({ title, year, posterUrl, children, footer }: MovieCardProps) {
  return (
    <div className="group flex flex-col gap-2.5">
      <div className="relative">
        <Poster src={posterUrl} alt={title} glow={false} />

        {/* The beam glow is off by default in the grid, and lit on hover --
            twenty simultaneous glows read as fog. */}
        {posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
          <img
            src={posterUrl}
            alt=""
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-[1.12] object-cover opacity-0 blur-2xl saturate-[2.2] transition-opacity duration-500 group-hover:opacity-70"
          />
        ) : null}

        {children ? <div className="absolute top-2 right-2 z-10">{children}</div> : null}
      </div>

      <div>
        <p className="truncate text-[14px] font-semibold text-fg">{title}</p>
        <p className="t-label mt-1 text-fg-faint">{year ?? "—"}</p>
      </div>

      {footer ? <div>{footer}</div> : null}
    </div>
  );
}
