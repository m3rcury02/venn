"use client";

// Last resort: this replaces the root layout, so `globals.css` and both fonts
// are never loaded here. Everything is inline for that reason -- a class name
// would resolve to nothing. Keep it dependency-free and keep it short.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          color: "#fff",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "22rem" }}>
          {/* The mark, hand-rolled: two beams and their additive overlap. */}
          <div
            aria-hidden
            style={{
              position: "relative",
              width: 56,
              height: 31,
              margin: "0 auto 24px",
              isolation: "isolate",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: 0,
                width: 31,
                height: 31,
                borderRadius: "50%",
                background: "#FF5A1F",
                mixBlendMode: "plus-lighter",
              }}
            />
            <span
              style={{
                position: "absolute",
                right: 0,
                width: 31,
                height: 31,
                borderRadius: "50%",
                background: "#00C2FF",
                mixBlendMode: "plus-lighter",
              }}
            />
          </div>

          <h1 style={{ fontSize: 30, margin: 0, letterSpacing: "-0.01em" }}>
            Venn broke
          </h1>
          <p style={{ color: "#8E8E99", fontSize: 15, marginTop: 12 }}>
            Something failed before the app could start.
          </p>
          {error.digest ? (
            <p
              style={{
                color: "#7F7F8A",
                fontSize: 12,
                marginTop: 12,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {error.digest}
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 28,
              background: "#FFE500",
              color: "#000",
              border: 0,
              borderRadius: 2,
              padding: "13px 22px",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
