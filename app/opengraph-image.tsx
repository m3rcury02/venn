import { ImageResponse } from "next/og";

// The preview WhatsApp, iMessage, Slack and X show when someone pastes a Venn
// link, invite links included. Before this, a pasted link showed the word
// "Venn" and nothing else. Rendered once at build time, since nothing in it
// changes per request.

export const alt = "Venn: pick a movie nobody hates";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEADLINE = "Pick a movie nobody hates";
const SUBTITLE = "Tick who's on the couch. Get three picks everyone will sit through.";

// The app's two faces (app/layout.tsx), but next/font doesn't expose their
// files to this renderer, so fetch them from Google Fonts at build. The css2
// API answers a non-browser user agent with a TrueType URL, which is what the
// renderer reads (it can't read woff2). `text=` trims each file to the glyphs
// it draws.
async function loadGoogleFont(family: string, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`,
    ).then((res) => res.text());
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    return await fetch(url).then((res) => res.arrayBuffer());
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  // Uppercased, because that's what textTransform draws.
  const [anton, archivo] = await Promise.all([
    loadGoogleFont("Anton", `${HEADLINE} Venn`.toUpperCase()),
    loadGoogleFont("Archivo", SUBTITLE),
  ]);
  // Both or neither. Custom fonts replace next/og's default rather than
  // adding to it, and the renderer takes each glyph from the first font that
  // has it, so Anton alone drew the subtitle's capital T in Anton. A failed
  // fetch falls back to the default face throughout, never to a failed build.
  const fonts =
    anton && archivo
      ? [
          { name: "Anton", data: anton, style: "normal" as const, weight: 400 as const },
          { name: "Archivo", data: archivo, style: "normal" as const, weight: 400 as const },
        ]
      : undefined;
  const display = fonts ? "Anton" : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#000000",
          color: "#ffffff",
          fontFamily: fonts ? "Archivo" : undefined,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {/* The mark, drawn as its three regions. The app gets the white lens
              from plus-lighter blending (components/venn-mark.tsx); this
              renderer has no plus-lighter, so the lens is circle B clipped to
              circle A and filled with the white the blend would produce. */}
          <svg width="88" height="64" viewBox="0 0 88 64">
            <defs>
              <clipPath id="lens">
                <circle cx="32" cy="32" r="30" />
              </clipPath>
            </defs>
            <circle cx="32" cy="32" r="30" fill="#ff5a1f" />
            <circle cx="56" cy="32" r="30" fill="#00c2ff" />
            <circle cx="56" cy="32" r="30" fill="#ffffff" clipPath="url(#lens)" />
          </svg>
          <div style={{ fontFamily: display, fontSize: 64, textTransform: "uppercase", lineHeight: 1 }}>
            Venn
          </div>
        </div>

        <div
          style={{
            fontFamily: display,
            fontSize: 132,
            lineHeight: 0.9,
            textTransform: "uppercase",
            maxWidth: 1000,
          }}
        >
          {HEADLINE}
        </div>

        <div style={{ fontSize: 30, color: "#8e8e99" }}>{SUBTITLE}</div>
      </div>
    ),
    { ...size, fonts },
  );
}
