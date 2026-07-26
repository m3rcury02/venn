// Write-through cache for the catalog (SPEC §3): "movies and movie_tags are a
// local cache. Fetch once on first sighting, never per read."
//
// This is the only place a provider record becomes internal rows, and the only
// place `movies.id` is minted.

import { PROVIDER_NAME, provider } from "../providers";
import type { Movie, Tag } from "../providers/types";
import { createServiceClient } from "../supabase/service";

type Db = ReturnType<typeof createServiceClient>;

/**
 * Resolves a provider id to the internal `movies.id`, fetching and caching the
 * movie the first time it is seen. Callers hold external ids; every foreign key
 * in the schema wants this uuid.
 */
export async function cacheMovie(externalId: string): Promise<string> {
  const db = createServiceClient();

  const cached = await lookup(db, externalId);
  if (cached) return cached;

  const [movie, tags] = await Promise.all([
    provider.getMovie(externalId),
    provider.getTags(externalId),
  ]);

  const movieId = await insertMovie(db, movie);
  await insertTags(db, movieId, tags);

  // Written last on purpose. This row is the only lookup path, so it is the
  // commit marker: failing before it leaves an orphaned movies row and the next
  // call re-fetches cleanly. The reverse order is what breaks -- a mapping with
  // fetched_at set but no tags, which nothing would ever re-fetch.
  const { error } = await db.from("movie_external_ids").insert({
    movie_id: movieId,
    provider: PROVIDER_NAME,
    external_id: externalId,
  });

  if (error) {
    // 23505: a concurrent call cached the same movie first. Its mapping won, so
    // ours is an orphan -- return the id that actually got mapped.
    if (error.code !== "23505") throw error;

    const winner = await lookup(db, externalId);
    if (!winner) throw error;
    return winner;
  }

  return movieId;
}

async function lookup(db: Db, externalId: string): Promise<string | null> {
  const { data, error } = await db
    .from("movie_external_ids")
    .select("movie_id")
    .eq("provider", PROVIDER_NAME)
    .eq("external_id", externalId)
    .maybeSingle();

  if (error) throw error;
  return data?.movie_id ?? null;
}

async function insertMovie(db: Db, movie: Movie): Promise<string> {
  const { data, error } = await db
    .from("movies")
    .insert({
      title: movie.title,
      original_title: movie.originalTitle,
      year: movie.year,
      poster_path: movie.posterPath,
      backdrop_path: movie.backdropPath,
      runtime: movie.runtime,
      overview: movie.overview,
      // rating_external is numeric(3,1) -- Postgres rounds 8.456 to 8.5. That
      // truncation is intended; do not "fix" it by rounding here first.
      rating_external: movie.ratingExternal,
      release_date: movie.releaseDate,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data.id;
}

async function insertTags(db: Db, movieId: string, tags: Tag[]): Promise<void> {
  if (tags.length === 0) return;

  // Tags are shared across movies, so this is an upsert; the insert below is
  // not. toTags() dedupes, which it has to -- a repeated (tag_type, tag_value)
  // in one batch would trip "ON CONFLICT DO UPDATE cannot affect row a second
  // time".
  const { data: rows, error: tagsError } = await db
    .from("tags")
    .upsert(
      tags.map((tag) => ({ tag_type: tag.type, tag_value: tag.value })),
      { onConflict: "tag_type,tag_value" },
    )
    .select("id");

  if (tagsError) throw tagsError;

  // weight keeps its column default of 1: §4.1 applies the per-type weight
  // (genre x3, person x2, keyword x1) at scoring time, read from tags.tag_type.
  const { error } = await db
    .from("movie_tags")
    .insert(rows.map((row) => ({ movie_id: movieId, tag_id: row.id })));

  if (error) throw error;
}
