// The absolute origin that link previews, the sitemap and robots.txt need.
// Relative URLs are fine inside the app, but an og:image or a sitemap entry
// has to name a host.
//
// NEXT_PUBLIC_SITE_URL wins, for a custom domain. Otherwise Vercel's own
// VERCEL_PROJECT_PRODUCTION_URL (set on every Vercel build, no protocol),
// which is the production domain even on a preview deploy, so a preview's
// shared links still unfurl with production's image.
export const SITE_URL = new URL(
  process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000"),
);

export const SITE_DESCRIPTION =
  "Everyone rates a few films. On movie night, tick who's there and Venn suggests three picks the whole room will sit through, with the reason for each.";
