// How long a remote-night lobby stays open (SPEC §4.5), counted from when it
// was opened (movie_nights.held_at). After this the night page stops showing
// it, and open_movie_night / join_movie_night / close_movie_night treat it as
// gone.
//
// The same 12 hours is written into those three functions in
// supabase/migrations/20260924130000_lobby_expiry.sql. Change both together;
// that migration explains why the number lives in two places.
export const LOBBY_TTL_HOURS = 12;

/** The oldest `held_at` a lobby can have and still be open. */
export function lobbyCutoff(now = Date.now()): string {
  return new Date(now - LOBBY_TTL_HOURS * 60 * 60 * 1000).toISOString();
}
