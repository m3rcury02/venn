import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { SITE_TAGLINE } from "@/lib/site";

// The share card for every link to Venn (Twitter/X falls back to og:image,
// so one file covers both). Rendered once at build time -- there are no
// params -- so it costs nothing per share.
//
// Anton is read from assets/fonts rather than fetched from Google Fonts at
// build: a network hiccup there would fail the deploy. It's SIL OFL 1.1,
// which allows bundling; the licence sits beside it.
//
// The mark is drawn as SVG with a clip-path for the lens, not with
// mix-blend-mode, which Satori doesn't implement. Same geometry as
// app/icon.svg and the PWA icons, so the white is the exact intersection.

export const alt = `Venn: ${SITE_TAGLINE.toLowerCase()}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const anton = await readFile(join(process.cwd(), "assets/fonts/Anton-Regular.ttf"));

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        background:
          "radial-gradient(55% 75% at 0% 0%, rgba(255,90,31,0.55), rgba(0,0,0,0) 70%), radial-gradient(55% 75% at 100% 100%, rgba(0,194,255,0.5), rgba(0,0,0,0) 70%), #000",
        padding: "0 72px",
        gap: 56,
      }}
    >
      <svg width="280" height="280" viewBox="0 0 100 100">
        <circle cx="31" cy="50" r="31" fill="#FF5A1F" />
        <circle cx="69" cy="50" r="31" fill="#00C2FF" />
        <clipPath id="lens">
          <circle cx="31" cy="50" r="31" />
        </clipPath>
        <circle cx="69" cy="50" r="31" fill="#FFFFFF" clipPath="url(#lens)" />
      </svg>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            fontFamily: "Anton",
            fontSize: 64,
            letterSpacing: 6,
            color: "#FFE500",
            textTransform: "uppercase",
          }}
        >
          Venn
        </div>
        {/* Two explicit lines: Satori doesn't wrap a long display line to
              the frame the way a browser would, it clips it. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontFamily: "Anton",
            fontSize: 150,
            lineHeight: 0.86,
            color: "#FFFFFF",
            textTransform: "uppercase",
            marginTop: 14,
          }}
        >
          <span>Find the</span>
          <span>overlap</span>
        </div>
        <div
          style={{
            fontFamily: "Anton",
            fontSize: 30,
            letterSpacing: 3,
            color: "rgba(255,255,255,0.82)",
            textTransform: "uppercase",
            marginTop: 30,
          }}
        >
          {SITE_TAGLINE}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: "Anton", data: anton, style: "normal", weight: 400 }],
    },
  );
}
