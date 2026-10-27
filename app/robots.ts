import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Open by default. An allow-list ("/" and the legal pages only) looks tidier
// but breaks things that aren't obvious from here: Googlebot needs /_next/
// to render the landing page, and Twitterbot honours robots.txt for the
// share-card image at /opengraph-image. Signed-in routes need no rule --
// a crawler gets a redirect to /login, and redirects aren't indexed.
// What's disallowed is machine endpoints, which have nothing to index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/auth/", "/share"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
