// SPEC §2's provider interface. Movie identity is provider-agnostic (§3): every
// shape here uses `externalId`, and mapping that to an internal uuid is the
// cache's job, not the provider's.

export type TagType = "genre" | "keyword" | "person";

export type Tag = {
  type: TagType;
  value: string;
};

/** Mirrors the `movies` table, plus the provider's own id. */
export type Movie = {
  externalId: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  runtime: number | null;
  overview: string | null;
  ratingExternal: number | null;
  /** ISO yyyy-mm-dd. */
  releaseDate: string | null;
};

/** What list endpoints return: no runtime or backdrop, those need a detail call. */
export type MovieSummary = {
  externalId: string;
  title: string;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
  ratingExternal: number | null;
};

export type WatchProviderType = "flatrate" | "rent" | "buy";

export type WatchProvider = {
  name: string;
  logoPath: string | null;
  type: WatchProviderType;
};

/**
 * Availability for one title in one region.
 *
 * `link` is per-region, not per-provider, which is why this is an object rather
 * than SPEC §2's bare array. It is a *TMDB* watch-page url, not a JustWatch
 * one — TMDB does not hand out JustWatch deep links.
 *
 * Displaying any of this obliges you to attribute JustWatch as the source of
 * the data; TMDB revokes API access over it. See docs/DECISIONS.md.
 */
export type WatchAvailability = {
  link: string | null;
  providers: WatchProvider[];
};

export type MovieExternalIds = {
  imdbId: string | null;
};

export type ImageSize =
  | "w92"
  | "w154"
  | "w185"
  | "w300"
  | "w342"
  | "w500"
  | "w780"
  | "w1280"
  | "original";

export interface MovieDataProvider {
  search(query: string, region: string): Promise<MovieSummary[]>;
  getMovie(externalId: string): Promise<Movie>;
  getTags(externalId: string): Promise<Tag[]>;
  getExternalIds(externalId: string): Promise<MovieExternalIds>;
  getWatchProviders(
    externalId: string,
    region: string,
  ): Promise<WatchAvailability>;
  getImageUrl(path: string, size: ImageSize): string;
  findByImdbId(imdbId: string): Promise<Movie | null>;
  nowPlaying(region: string): Promise<MovieSummary[]>;
  upcoming(region: string): Promise<MovieSummary[]>;
}
