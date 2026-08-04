import type { SupabaseClient } from "@supabase/supabase-js";

// auth-js verifies getClaims() against the project's JWKS, fetched from
// /auth/v1/.well-known/jwks.json. It caches that fetch on the client
// *instance* -- but this app builds a fresh Supabase client per request (see
// lib/supabase/server.ts and lib/supabase/proxy.ts), so the instance cache
// was always cold and every getClaims() call paid a network round trip before
// it could verify anything. Caching the JWKS here, at module scope, makes
// every call after the first in a warm serverless instance purely local.
//
// options.jwks (not the deprecated options.keys) is what getClaims() reads;
// passing it makes auth-js's internal fetchJwk() return the cached key
// immediately instead of re-fetching.
let cached: { jwks: { keys: JWKLike[] }; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000; // matches auth-js's own JWKS_TTL

// Shape of auth-js's own (non-exported) JWK type -- kty and key_ops are the
// two fields it requires; the rest passes through untyped.
type JWKLike = { kty: string; key_ops: string[]; kid?: string; [key: string]: unknown };

export async function getClaims(supabase: SupabaseClient) {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    try {
      // Same env var every client in this app is already built from (see
      // lib/supabase/server.ts, client.ts, proxy.ts) -- not read off the
      // client instance, whose supabaseUrl is a protected/internal field.
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const response = await fetch(`${url}/auth/v1/.well-known/jwks.json`);
      if (!response.ok) throw new Error(`jwks ${response.status}`);
      const jwks = (await response.json()) as { keys: JWKLike[] };
      cached = { jwks, at: Date.now() };
    } catch {
      // Fall back to the uncached call -- same behaviour as before this file
      // existed, just no speedup this time.
      return supabase.auth.getClaims();
    }
  }

  return supabase.auth.getClaims(undefined, { jwks: cached.jwks });
}
