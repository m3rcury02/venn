// Ingest tokens: mint, hash, verify.
//
// SPEC §5: "Treat the token as low-trust: ingest scope only, revocable,
// rate-limited." The scope is structural -- a token buys nothing except the
// right to POST /api/ingest as one user.
//
// Server-side only. INGEST_TOKEN_PEPPER (§11) carries no NEXT_PUBLIC_ prefix
// and is undefined in the browser.

import { createHmac, randomBytes } from "node:crypto";
import { createServiceClient } from "../supabase/service";

/**
 * Read at module load rather than per call, and it throws.
 *
 * This is the one guard here that is not defensive coding against a
 * hypothetical: with the variable unset, `createHmac(alg, undefined)` does not
 * fail -- it keys on the empty/coerced value, so every token hashes under the
 * same wrong key and *everything keeps working*. Tokens would mint and verify
 * happily until the day the variable appears, at which point every token in the
 * database becomes unverifiable at once, with no error anywhere in between.
 */
function requirePepper(): string {
  const pepper = process.env.INGEST_TOKEN_PEPPER;

  if (!pepper) {
    throw new Error(
      "INGEST_TOKEN_PEPPER is not set. Ingest tokens would all hash under the " +
        "same wrong key and no error would surface until it is.",
    );
  }

  return pepper;
}

const PEPPER = requirePepper();

/** Recognisable in a log or a Shortcut field, and namespaced against pastes. */
const PREFIX = "vn_";

/** 32 bytes. There is no dictionary to defend against at this size. */
const TOKEN_BYTES = 32;

/**
 * A new token, in plaintext. This is the only time it exists in that form --
 * only `hashToken` of it is stored, so a lost token is reminted, never
 * recovered.
 */
export function mintToken(): string {
  return `${PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

/**
 * Keyed hash, deliberately deterministic: the verify path looks a token up by
 * this value through a unique index, and a per-row salt would turn every ingest
 * request into a full table scan. The token is 32 random bytes, so the pepper is
 * not standing in for password-hashing work -- it is what makes a leaked
 * database dump useless without the server's environment.
 */
export function hashToken(token: string): string {
  return createHmac("sha256", PEPPER).update(token).digest("hex");
}

/**
 * Resolves a token to its owner, or null. Stamps `last_used_at` so Settings can
 * show which token is actually in use before someone revokes the wrong one.
 *
 * Runs as service_role: this is called before any user identity exists, so
 * there is no session for RLS to key on.
 */
export async function verifyToken(token: string): Promise<string | null> {
  const db = createServiceClient();

  const { data, error } = await db
    .from("ingest_tokens")
    .select("id, user_id")
    .eq("token_hash", hashToken(token))
    // Revocation is checked here rather than after the fetch so that a revoked
    // token is indistinguishable from one that never existed.
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;

  await db
    .from("ingest_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return data.user_id;
}
