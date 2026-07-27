import { VennMark } from "@/components/venn-mark";

// A poster, plus the light it throws.
//
// The glow is the same hotlinked `image.tmdb.org` URL rendered a second time,
// blurred and over-saturated behind the sharp copy, so the film's own palette
// floods the black around it. The browser serves it from cache -- it is one
// request, painted twice. Still a plain `<img>`, still never re-hosted
// (CLAUDE.md), because `next/image` would proxy the bytes through Vercel.
//
// `.grain-art` sits over the artwork only. The page-level grain deliberately
// renders *under* all content so it never touches text; here there is no text
// to degrade, so the texture goes on top where you can actually see it.

type PosterProps = {
  src: string | null;
  alt: string;
  /** The blurred copy behind the art. Off in dense grids, where it muddies. */
  glow?: boolean;
  /** Size of the fallback mark when there is no poster. */
  markSize?: number;
  className?: string;
};

export function Poster({
  src,
  alt,
  glow = true,
  markSize = 26,
  className,
}: PosterProps) {
  return (
    <div className={`relative aspect-[2/3] ${className ?? ""}`}>
      {src && glow ? (
        // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
        <img
          src={src}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 h-full w-full scale-[1.15] object-cover opacity-65 blur-2xl saturate-[2.2]"
        />
      ) : null}

      <div className="absolute inset-0 overflow-hidden rounded-card border border-hairline bg-surface-2">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- hotlinked provider CDN, never re-hosted
          <img src={src} alt={alt} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <VennMark size={markSize} />
          </div>
        )}
        <div className="grain-art" aria-hidden />
      </div>
    </div>
  );
}
