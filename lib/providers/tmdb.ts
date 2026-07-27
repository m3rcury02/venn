// TMDB implementation of MovieDataProvider.
//
// Server-side only. TMDB_API_KEY carries no NEXT_PUBLIC_ prefix on purpose --
// this repo is public and that prefix ships the key to the browser.
//
// Deliberately free of Next-specific APIs (no next/cache, no server-only): the
// phase 1a smoke script imports this module under plain node.
//
// Movies and TV shows are separate TMDB endpoints (`/movie/...` vs `/tv/...`)
// with different field names, and their id spaces are independent -- movie 1396
// and tv 1396 are unrelated titles. `externalId` therefore carries the media
// type as a prefix (`"movie-1396"` / `"tv-1396"`); parseExternalId/toExternalId
// below are the only place that prefix is created or read. A hyphen, not a
// colon: verified against the actual dev server that Next's dynamic route
// params arrive percent-encoded and undecoded for a colon (`externalId` came
// through as the literal string "movie%3A1396", never matching), which breaks
// /movies/external/[externalId] for every request. A hyphen is an unreserved
// URL character and needs no encoding at all.

import type {
  ImageSize,
  MediaType,
  Movie,
  MovieDataProvider,
  MovieExternalIds,
  MovieSummary,
  Tag,
  WatchProviderType,
} from "./types";

const API = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p";

/** Billed cast kept as `person` tags. Below this the signal is mostly noise. */
const CAST_LIMIT = 10;

/**
 * Extra attempts after a *connection* failure. TMDB resets roughly one
 * connection in five from some networks (see docs/DECISIONS.md), which is not
 * something the caller can do anything useful about. Two retries take that to
 * well under 1%. HTTP error responses are not retried -- a 401 or a 404 will
 * say the same thing the second time.
 */
const RETRIES = 2;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------ raw responses

// Only the fields actually read. TMDB returns far more.

type TmdbMovieListItem = {
  id: number;
  title: string;
  poster_path: string | null;
  overview: string | null;
  vote_average: number | null;
  release_date: string | null;
};

type TmdbTvListItem = {
  id: number;
  name: string;
  poster_path: string | null;
  overview: string | null;
  vote_average: number | null;
  first_air_date: string | null;
};

// /search/multi tags each row with which of the two it is, plus a third kind
// (person) that carries no title at all and is filtered out at the call site.
type TmdbMultiResult =
  | ({ media_type: "movie" } & TmdbMovieListItem)
  | ({ media_type: "tv" } & TmdbTvListItem)
  | { media_type: "person"; id: number };

type TmdbMovieDetail = TmdbMovieListItem & {
  original_title: string | null;
  backdrop_path: string | null;
  runtime: number | null;
};

type TmdbTvDetail = TmdbTvListItem & {
  original_name: string | null;
  backdrop_path: string | null;
  // TMDB has no single runtime for a series. Verified against /tv/1396
  // (Breaking Bad): this array comes back empty even for a well-catalogued show.
  episode_run_time: number[];
};

type TmdbMovieDetailWithTags = TmdbMovieDetail & {
  genres: { name: string }[];
  keywords: { keywords: { name: string }[] };
  credits: {
    cast: { name: string }[];
    crew: { name: string; job: string }[];
  };
};

type TmdbTvDetailWithTags = TmdbTvDetail & {
  genres: { name: string }[];
  // Verified against /tv/1396: TV keywords come back under `results`, not
  // `keywords` -- the movie endpoint's key name.
  keywords: { results: { name: string }[] };
  credits: {
    cast: { name: string }[];
    crew: { name: string; job: string }[];
  };
  // Verified against /tv/1396: TV credits carry no crew entry with
  // job === "Director". A series' creators live here instead.
  created_by: { name: string }[];
};

type TmdbCompany = { provider_name: string; logo_path: string | null };
type TmdbExternalIds = { imdb_id: string | null };
type TmdbFindResult = {
  movie_results: TmdbMovieListItem[];
  tv_results: TmdbTvListItem[];
};

// ----------------------------------------------------------------- fetching

async function get<T>(
  path: string,
  params: Record<string, string> = {},
): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  for (let attempt = 0; ; attempt++) {
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
          accept: "application/json",
        },
      });
    } catch (error) {
      // Network-level throw only -- see RETRIES. An HTTP error response falls
      // through to the check below and is never retried.
      if (attempt === RETRIES) throw error;
      await sleep(200 * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      throw new Error(
        `TMDB ${response.status} ${response.statusText} on ${path}`,
      );
    }

    return response.json() as Promise<T>;
  }
}

// -------------------------------------------------------------- external id

const EXTERNAL_ID_PATTERN = /^(movie|tv)-([1-9]\d*)$/;

function parseExternalId(externalId: string): { mediaType: MediaType; id: string } {
  const match = EXTERNAL_ID_PATTERN.exec(externalId);
  if (!match) throw new Error(`Malformed TMDB external id: ${externalId}`);
  return { mediaType: match[1] as MediaType, id: match[2] };
}

function toExternalId(mediaType: MediaType, id: number | string): string {
  return `${mediaType}-${id}`;
}

// ------------------------------------------------------------------ mapping

// TMDB sends "" rather than null for an unknown release date, which the `date`
// column rejects outright. Year is derived from the coerced value so it comes
// out null too, not NaN.
function toReleaseDate(raw: string | null): string | null {
  return raw || null;
}

function toYear(releaseDate: string | null): number | null {
  return releaseDate ? Number(releaseDate.slice(0, 4)) : null;
}

// 0 from TMDB means "unknown" on both of these, not a zero-minute film or a
// film rated zero.
function toMovieSummary(item: TmdbMovieListItem): MovieSummary {
  const releaseDate = toReleaseDate(item.release_date);

  return {
    externalId: toExternalId("movie", item.id),
    mediaType: "movie",
    title: item.title,
    year: toYear(releaseDate),
    posterPath: item.poster_path,
    overview: item.overview || null,
    ratingExternal: item.vote_average || null,
  };
}

function toTvSummary(item: TmdbTvListItem): MovieSummary {
  const releaseDate = toReleaseDate(item.first_air_date);

  return {
    externalId: toExternalId("tv", item.id),
    mediaType: "tv",
    title: item.name,
    year: toYear(releaseDate),
    posterPath: item.poster_path,
    overview: item.overview || null,
    ratingExternal: item.vote_average || null,
  };
}

function toMovieDetail(detail: TmdbMovieDetail): Movie {
  const releaseDate = toReleaseDate(detail.release_date);

  return {
    ...toMovieSummary(detail),
    originalTitle: detail.original_title,
    backdropPath: detail.backdrop_path,
    runtime: detail.runtime || null,
    releaseDate,
  };
}

function toTvDetail(detail: TmdbTvDetail): Movie {
  const releaseDate = toReleaseDate(detail.first_air_date);

  return {
    ...toTvSummary(detail),
    originalTitle: detail.original_name,
    backdropPath: detail.backdrop_path,
    runtime: detail.episode_run_time[0] || null,
    releaseDate,
  };
}

// A director/creator who also appears in the cast would otherwise collide on
// movie_tags' (movie_id, tag_id) primary key during the upsert.
function dedupeTags(tags: Tag[]): Tag[] {
  return [...new Map(tags.map((t) => [`${t.type}:${t.value}`, t])).values()];
}

function toMovieTags(detail: TmdbMovieDetailWithTags): Tag[] {
  return dedupeTags([
    ...detail.genres.map((g) => ({ type: "genre" as const, value: g.name })),
    ...detail.keywords.keywords.map((k) => ({
      type: "keyword" as const,
      value: k.name,
    })),
    ...detail.credits.cast.slice(0, CAST_LIMIT).map((c) => ({
      type: "person" as const,
      value: c.name,
    })),
    ...detail.credits.crew
      .filter((c) => c.job === "Director")
      .map((c) => ({ type: "person" as const, value: c.name })),
  ]);
}

function toTvTags(detail: TmdbTvDetailWithTags): Tag[] {
  return dedupeTags([
    ...detail.genres.map((g) => ({ type: "genre" as const, value: g.name })),
    ...detail.keywords.results.map((k) => ({
      type: "keyword" as const,
      value: k.name,
    })),
    ...detail.credits.cast.slice(0, CAST_LIMIT).map((c) => ({
      type: "person" as const,
      value: c.name,
    })),
    ...detail.created_by.map((c) => ({ type: "person" as const, value: c.name })),
  ]);
}

// ----------------------------------------------------------------- provider

async function getMovie(externalId: string): Promise<Movie> {
  const { mediaType, id } = parseExternalId(externalId);

  return mediaType === "movie"
    ? toMovieDetail(await get<TmdbMovieDetail>(`/movie/${id}`))
    : toTvDetail(await get<TmdbTvDetail>(`/tv/${id}`));
}

export const tmdb: MovieDataProvider = {
  async search(query, region) {
    const { results } = await get<{ results: TmdbMultiResult[] }>("/search/multi", {
      query,
      region,
      include_adult: "false",
    });

    // /search/multi also returns people (cast/crew) alongside titles; the
    // provider interface has no room for a third result kind, and a person is
    // not something you can add to a list.
    return results.flatMap((item) => {
      if (item.media_type === "movie") return [toMovieSummary(item)];
      if (item.media_type === "tv") return [toTvSummary(item)];
      return [];
    });
  },

  getMovie,

  async getTags(externalId) {
    const { mediaType, id } = parseExternalId(externalId);

    // Genres, keywords and people in one round trip.
    if (mediaType === "movie") {
      const detail = await get<TmdbMovieDetailWithTags>(`/movie/${id}`, {
        append_to_response: "keywords,credits",
      });
      return toMovieTags(detail);
    }

    const detail = await get<TmdbTvDetailWithTags>(`/tv/${id}`, {
      append_to_response: "keywords,credits",
    });
    return toTvTags(detail);
  },

  async getExternalIds(externalId): Promise<MovieExternalIds> {
    const { mediaType, id } = parseExternalId(externalId);
    const ids = await get<TmdbExternalIds>(`/${mediaType}/${id}/external_ids`);
    return { imdbId: ids.imdb_id || null };
  },

  async getWatchProviders(externalId, region) {
    const { mediaType, id } = parseExternalId(externalId);

    const { results } = await get<{
      results: Record<
        string,
        { link?: string } & Partial<Record<WatchProviderType, TmdbCompany[]>>
      >;
    }>(`/${mediaType}/${id}/watch/providers`);

    const forRegion = results[region];
    if (!forRegion) return { link: null, providers: [] };

    const types: WatchProviderType[] = ["flatrate", "rent", "buy"];

    return {
      link: forRegion.link ?? null,
      providers: types.flatMap((type) =>
        (forRegion[type] ?? []).map((company) => ({
          name: company.provider_name,
          logoPath: company.logo_path,
          type,
        })),
      ),
    };
  },

  getImageUrl(path: string, size: ImageSize) {
    return `${IMAGE_BASE}/${size}${path}`;
  },

  async findByImdbId(imdbId) {
    const { movie_results, tv_results } = await get<TmdbFindResult>(
      `/find/${imdbId}`,
      { external_source: "imdb_id" },
    );

    // /find returns a list-shaped row with no runtime or backdrop, so the full
    // record still needs its own call, in whichever bucket had the hit.
    const movieHit = movie_results[0];
    if (movieHit) return getMovie(toExternalId("movie", movieHit.id));

    const tvHit = tv_results[0];
    return tvHit ? getMovie(toExternalId("tv", tvHit.id)) : null;
  },

  async nowPlaying(region) {
    const { results } = await get<{ results: TmdbMovieListItem[] }>(
      "/movie/now_playing",
      { region },
    );

    return results.map(toMovieSummary);
  },

  async upcoming(region) {
    const { results } = await get<{ results: TmdbMovieListItem[] }>(
      "/movie/upcoming",
      { region },
    );

    return results.map(toMovieSummary);
  },
};
