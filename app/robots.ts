import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Everything past the landing and legal pages is behind sign-in, so a crawler
// following a link there only finds /login. The disallows keep endpoints and
// invite links (which only redirect) out of the index.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: ["/api/", "/auth/", "/join/", "/share"],
    },
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
  };
}
