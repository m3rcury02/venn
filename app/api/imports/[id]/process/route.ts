import { NextResponse } from "next/server";
import {
  cacheMovie,
  cacheMovieByImdbId,
} from "@/lib/movies/cache";
import { normalizeImportTitle } from "@/lib/imports/normalize";
import { provider } from "@/lib/providers";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

async function syncProgress(
  supabase: Awaited<ReturnType<typeof createClient>>,
  importId: string,
) {
  const [processedResult, matchedResult] = await Promise.all([
    supabase
      .from("import_rows")
      .select("id", { count: "exact", head: true })
      .eq("import_id", importId)
      .neq("status", "pending"),
    supabase
      .from("import_rows")
      .select("id", { count: "exact", head: true })
      .eq("import_id", importId)
      .eq("status", "matched"),
  ]);

  await supabase
    .from("imports")
    .update({
      processed: processedResult.count ?? 0,
      matched: matchedResult.count ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId);
}

async function finishIfReady(
  supabase: Awaited<ReturnType<typeof createClient>>,
  importId: string,
) {
  const { data, error } = await supabase.rpc("finish_import", {
    p_import_id: importId,
  });
  if (error) throw error;
  return data as string;
}

export async function POST(_request: Request, { params }: RouteContext) {
  const { id: importId } = await params;
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  if (typeof claims?.claims?.sub !== "string") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: job } = await supabase
    .from("imports")
    .select("source, status")
    .eq("id", importId)
    .single();
  if (!job) return NextResponse.json({ error: "Import not found." }, { status: 404 });
  if (job.status !== "processing") {
    return NextResponse.json({ status: job.status });
  }

  const { data: row, error: rowError } = await supabase
    .from("import_rows")
    .select(
      "id, imdb_id, title, year, expected_media_type, attempts",
    )
    .eq("import_id", importId)
    .eq("status", "pending")
    .order("row_number")
    .limit(1)
    .maybeSingle();
  if (rowError) {
    return NextResponse.json({ error: "Couldn't read the import." }, { status: 500 });
  }

  if (!row) {
    const status = await finishIfReady(supabase, importId);
    return NextResponse.json({ status });
  }

  try {
    let movieId: string | null = null;
    let candidateIds: string[] = [];
    let unmatchedReason = "No confident catalog match.";

    if (job.source === "imdb") {
      movieId = row.imdb_id ? await cacheMovieByImdbId(row.imdb_id) : null;
      unmatchedReason = movieId ? "" : "IMDb no longer resolves this title.";
    } else {
      const { data: profile } = await supabase
        .from("profiles")
        .select("region")
        .single();
      const results = (await provider.search(row.title, profile?.region ?? "IN")).filter(
        (movie) =>
          !row.expected_media_type ||
          movie.mediaType === row.expected_media_type,
      );
      const normalized = normalizeImportTitle(row.title);
      const titleMatches = results.filter(
        (movie) => normalizeImportTitle(movie.title) === normalized,
      );
      const exact = titleMatches.filter(
        (movie) => row.year === null || movie.year === row.year,
      );

      if (exact.length === 1) {
        movieId = await cacheMovie(exact[0].externalId);
      } else {
        const cached = await Promise.allSettled(
          results.slice(0, 3).map((movie) => cacheMovie(movie.externalId)),
        );
        candidateIds = cached.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        unmatchedReason =
          exact.length > 1 ? "More than one exact title matched." : "No exact title and year matched.";
      }
    }

    if (movieId) {
      const { error } = await supabase.rpc("apply_import_match", {
        p_row_id: row.id,
        p_movie_id: movieId,
      });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("import_rows")
        .update({
          status: "unmatched",
          attempts: row.attempts + 1,
          candidate_movie_ids: candidateIds,
          error: unmatchedReason,
        })
        .eq("id", row.id)
        .eq("status", "pending");
      if (error) throw error;
    }

    await syncProgress(supabase, importId);
    const status = await finishIfReady(supabase, importId);
    return NextResponse.json({ status });
  } catch {
    const attempts = row.attempts + 1;
    const terminal = attempts >= 3;
    await supabase
      .from("import_rows")
      .update({
        attempts,
        status: terminal ? "unmatched" : "pending",
        error: terminal
          ? "Catalog lookup failed after three attempts."
          : "Catalog lookup failed; retrying.",
      })
      .eq("id", row.id)
      .eq("status", "pending");

    await syncProgress(supabase, importId);
    const status = terminal
      ? await finishIfReady(supabase, importId)
      : "processing";
    return NextResponse.json({ status, retrying: !terminal });
  }
}
