// TMDB implementation of MovieDataProvider.
//
// Server-side only. TMDB_API_KEY carries no NEXT_PUBLIC_ prefix on purpose --
// this repo is public and that prefix ships the key to the browser.
//
// Deliberately free of Next-specific APIs (no next/cache, no server-only): the
// phase 1a smoke script imports this module under plain node.

import type {
  ImageSize,
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

type TmdbListItem = {
  id: number;
  title: string;
  poster_path: string | null;
  overview: string | null;
  vote_average: number | null;
  release_date: string | null;
};

type TmdbDetail = TmdbListItem & {
  original_title: string | null;
  backdrop_path: string | null;
  runtime: number | null;
};

type TmdbDetailWithTags = TmdbDetail & {
  genres: { name: string }[];
  keywords: { keywords: { name: string }[] };
  credits: {
    cast: { name: string }[];
    crew: { name: string; job: string }[];
  };
};

type TmdbCompany = { provider_name: string; logo_path: string | null };
type TmdbExternalIds = { imdb_id: string | null };

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
function toSummary(item: TmdbListItem): MovieSummary {
  const releaseDate = toReleaseDate(item.release_date);

  return {
    externalId: String(item.id),
    title: item.title,
    year: toYear(releaseDate),
    posterPath: item.poster_path,
    overview: item.overview || null,
    ratingExternal: item.vote_average || null,
  };
}

function toMovie(detail: TmdbDetail): Movie {
  const releaseDate = toReleaseDate(detail.release_date);

  return {
    ...toSummary(detail),
    originalTitle: detail.original_title,
    backdropPath: detail.backdrop_path,
    runtime: detail.runtime || null,
    releaseDate,
  };
}

function toTags(detail: TmdbDetailWithTags): Tag[] {
  const tags: Tag[] = [
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
  ];

  // A director who also appears in the cast would otherwise collide on
  // movie_tags' (movie_id, tag_id) primary key during the upsert.
  return [...new Map(tags.map((t) => [`${t.type}:${t.value}`, t])).values()];
}

// ----------------------------------------------------------------- provider

async function getMovie(externalId: string): Promise<Movie> {
  return toMovie(await get<TmdbDetail>(`/movie/${externalId}`));
}

export const tmdb: MovieDataProvider = {
  async search(query, region) {
    const { results } = await get<{ results: TmdbListItem[] }>("/search/movie", {
      query,
      region,
      include_adult: "false",
    });

    return results.map(toSummary);
  },

  getMovie,

  async getTags(externalId) {
    // Genres, keywords and people in one round trip.
    const detail = await get<TmdbDetailWithTags>(`/movie/${externalId}`, {
      append_to_response: "keywords,credits",
    });

    return toTags(detail);
  },

  async getExternalIds(externalId): Promise<MovieExternalIds> {
    const ids = await get<TmdbExternalIds>(`/movie/${externalId}/external_ids`);
    return { imdbId: ids.imdb_id || null };
  },

  async getWatchProviders(externalId, region) {
    const { results } = await get<{
      results: Record<
        string,
        { link?: string } & Partial<Record<WatchProviderType, TmdbCompany[]>>
      >;
    }>(`/movie/${externalId}/watch/providers`);

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
    const { movie_results } = await get<{ movie_results: TmdbListItem[] }>(
      `/find/${imdbId}`,
      { external_source: "imdb_id" },
    );

    const hit = movie_results[0];
    // /find returns a list-shaped row with no runtime or backdrop, so the full
    // record still needs its own call.
    return hit ? getMovie(String(hit.id)) : null;
  },

  async nowPlaying(region) {
    const { results } = await get<{ results: TmdbListItem[] }>(
      "/movie/now_playing",
      { region },
    );

    return results.map(toSummary);
  },

  async upcoming(region) {
    const { results } = await get<{ results: TmdbListItem[] }>(
      "/movie/upcoming",
      { region },
    );

    return results.map(toSummary);
  },
};
