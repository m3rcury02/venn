// The public origin, for anything that has to be an absolute URL: Open Graph
// and Twitter images, the sitemap, robots.txt, canonical links.
//
// NEXT_PUBLIC_SITE_URL wins when set (a custom domain). Otherwise Vercel's own
// VERCEL_PROJECT_PRODUCTION_URL, which it sets at build and run time to the
// project's production domain -- so preview deployments still point share
// cards at production rather than at a preview URL that will be deleted.
// Locally, neither exists.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const SITE_NAME = "Venn";

// One sentence, used as the default description everywhere a page doesn't
// set its own, and on the share card.
export const SITE_TAGLINE = "Movie night, minus the argument";
export const SITE_DESCRIPTION =
  "Shared watchlists for your friends. When it's time to choose, Venn picks three films the whole group will enjoy, and tells you why.";
