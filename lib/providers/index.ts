import { tmdb } from "./tmdb";
import type { MovieDataProvider } from "./types";

export type * from "./types";

/**
 * The single provider instance the app talks to. Swapping providers (SPEC §2)
 * means changing this line and remapping `movie_external_ids` -- nothing else
 * imports `tmdb.ts` directly.
 */
export const provider: MovieDataProvider = tmdb;

/** Written to `movie_external_ids.provider`. */
export const PROVIDER_NAME = "tmdb";
