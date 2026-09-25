import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Only the pages a signed-out visitor can read. Each is in PUBLIC_PATHS in
// lib/supabase/proxy.ts.
const PUBLIC_PAGES = ["/welcome", "/about", "/privacy", "/terms", "/accessibility"];

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((path) => ({ url: new URL(path, SITE_URL).toString() }));
}
