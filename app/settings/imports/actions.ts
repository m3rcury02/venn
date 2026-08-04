"use server";

import { revalidatePath } from "next/cache";
import { cacheMovie } from "@/lib/movies/cache";
import type {
  ImportSource,
  NormalizedImportRow,
} from "@/lib/imports/types";
import { provider, type MediaType } from "@/lib/providers";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export type ImportSearchResult = {
  externalId: string;
  title: string;
  year: number | null;
  mediaType: MediaType;
  posterUrl: string | null;
};

async function userId() {
  const supabase = await createClient();
  const { data } = await getClaims(supabase);
  const id = data?.claims?.sub;
  return typeof id === "string" ? id : null;
}

export async function createImport(
  source: ImportSource,
  total: number,
): Promise<ActionResult<string>> {
  const id = await userId();
  if (!id) return { ok: false, error: "Not signed in." };
  if (!["imdb", "letterboxd"].includes(source) || !Number.isInteger(total) || total < 1) {
    return { ok: false, error: "The import has no valid rows." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("imports")
    .insert({ user_id: id, source, total })
    .select("id")
    .single();

  if (error?.code === "23505") {
    return { ok: false, error: "Finish the current import before starting another." };
  }
  if (error) return { ok: false, error: "Couldn't create the import." };
  return { ok: true, data: data.id };
}

export async function appendImportRows(
  importId: string,
  rows: NormalizedImportRow[],
): Promise<ActionResult> {
  if (!importId || rows.length < 1 || rows.length > 200) {
    return { ok: false, error: "Invalid import batch." };
  }

  const valid = rows.every(
    (row) =>
      Number.isInteger(row.rowNumber) &&
      row.rowNumber > 0 &&
      row.title.trim() &&
      (row.rating === null || ["hate", "like", "love"].includes(row.rating)) &&
      (row.expectedMediaType === null ||
        row.expectedMediaType === "movie" ||
        row.expectedMediaType === "tv"),
  );
  if (!valid) return { ok: false, error: "The import contains an invalid row." };

  const supabase = await createClient();
  const { error } = await supabase.from("import_rows").insert(
    rows.map((row) => ({
      import_id: importId,
      row_number: row.rowNumber,
      imdb_id: row.imdbId,
      title: row.title.trim(),
      year: row.year,
      expected_media_type: row.expectedMediaType,
      watched: row.watched,
      rating: row.rating,
    })),
  );

  return error
    ? { ok: false, error: "Couldn't upload part of the import." }
    : { ok: true, data: undefined };
}

export async function startImport(importId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const [{ data: job }, { count }] = await Promise.all([
    supabase
      .from("imports")
      .select("total, status")
      .eq("id", importId)
      .single(),
    supabase
      .from("import_rows")
      .select("id", { count: "exact", head: true })
      .eq("import_id", importId),
  ]);

  if (!job || job.status !== "uploading" || count !== job.total) {
    return { ok: false, error: "The import upload is incomplete." };
  }

  const { error } = await supabase
    .from("imports")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("status", "uploading");

  if (error) return { ok: false, error: "Couldn't start the import." };
  revalidatePath("/settings/imports");
  return { ok: true, data: undefined };
}

export async function failImport(importId: string, message: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("imports")
    .update({
      status: "failed",
      error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("status", "uploading");
  revalidatePath("/settings/imports");
}

export async function applyCachedImportCandidate(
  rowId: string,
  movieId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_import_match", {
    p_row_id: rowId,
    p_movie_id: movieId,
  });
  if (error) return { ok: false, error: "Couldn't apply that match." };

  revalidatePath("/");
  revalidatePath("/settings/imports");
  return { ok: true, data: undefined };
}

export async function resolveImportRow(
  rowId: string,
  externalId: string,
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("import_rows")
    .select("id")
    .eq("id", rowId)
    .eq("status", "unmatched")
    .single();
  if (!row) return { ok: false, error: "Import row not found." };

  let movieId: string;
  try {
    movieId = await cacheMovie(externalId);
  } catch {
    return { ok: false, error: "Couldn't load that title." };
  }

  const { error } = await supabase.rpc("apply_import_match", {
    p_row_id: rowId,
    p_movie_id: movieId,
  });
  if (error) return { ok: false, error: "Couldn't apply that match." };

  revalidatePath("/");
  revalidatePath("/settings/imports");
  return { ok: true, data: undefined };
}

export async function dismissImportRow(rowId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_import_row", {
    p_row_id: rowId,
  });
  if (error) return { ok: false, error: "Couldn't dismiss that row." };

  revalidatePath("/settings/imports");
  return { ok: true, data: undefined };
}

export async function searchImportMovies(
  rowId: string,
  query: string,
): Promise<ImportSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const supabase = await createClient();
  const [{ data: row }, { data: profile }] = await Promise.all([
    supabase
      .from("import_rows")
      .select("expected_media_type")
      .eq("id", rowId)
      .eq("status", "unmatched")
      .single(),
    supabase.from("profiles").select("region").single(),
  ]);
  if (!row) return [];

  const results = await provider.search(trimmed, profile?.region ?? "IN");
  return results
    .filter(
      (movie) =>
        !row.expected_media_type || movie.mediaType === row.expected_media_type,
    )
    .slice(0, 8)
    .map((movie) => ({
      externalId: movie.externalId,
      title: movie.title,
      year: movie.year,
      mediaType: movie.mediaType,
      posterUrl: movie.posterPath
        ? provider.getImageUrl(movie.posterPath, "w185")
        : null,
    }));
}
