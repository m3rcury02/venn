import { createClient } from "@supabase/supabase-js";

/**
 * The catalog tables (`movies`, `movie_external_ids`, `tags`, `movie_tags`)
 * have SELECT policies and no write policies at all. That absence is the
 * enforcement for CLAUDE.md's "provider calls are server-side only" -- the
 * write-through is unwritable from the browser.
 *
 * service_role bypasses RLS, so this client is the only thing that can fill
 * them. Server-side only: SUPABASE_SERVICE_ROLE_KEY has no NEXT_PUBLIC_ prefix
 * and is undefined in the browser.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
