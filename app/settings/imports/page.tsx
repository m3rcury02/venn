import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { ImportProgressRefresh } from "@/components/import-progress-refresh";
import {
  ImportReviewRow,
  type CachedImportCandidate,
  type ReviewImportRow,
} from "@/components/import-review-row";
import { ImportUpload } from "@/components/import-upload";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { provider } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

type ImportJob = {
  id: string;
  source: "imdb" | "letterboxd";
  status: "uploading" | "processing" | "needs_review" | "completed" | "failed";
  total: number;
  processed: number;
  matched: number;
  error: string | null;
  created_at: string;
};

type ImportRowRecord = ReviewImportRow & {
  candidate_movie_ids: string[];
};

const statusLabel: Record<ImportJob["status"], string> = {
  uploading: "Uploading",
  processing: "Processing",
  needs_review: "Needs review",
  completed: "Completed",
  failed: "Failed",
};

export default async function ImportsPage() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (typeof claims?.claims?.sub !== "string") redirect("/login");

  const [{ data: jobData }, { data: rowData }] = await Promise.all([
    supabase
      .from("imports")
      .select("id, source, status, total, processed, matched, error, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("import_rows")
      .select(
        "id, title, year, imdb_id, watched, rating, error, candidate_movie_ids, imports!inner(status)",
      )
      .eq("status", "unmatched")
      .eq("imports.status", "needs_review")
      .order("created_at"),
  ]);

  const jobs = (jobData ?? []) as ImportJob[];
  const rows = ((rowData ?? []) as unknown as {
    id: string;
    title: string;
    year: number | null;
    imdb_id: string | null;
    watched: boolean;
    rating: ReviewImportRow["rating"];
    error: string | null;
    candidate_movie_ids: string[];
  }[]).map((row) => ({
    id: row.id,
    title: row.title,
    year: row.year,
    imdbId: row.imdb_id,
    watched: row.watched,
    rating: row.rating,
    error: row.error,
    candidate_movie_ids: row.candidate_movie_ids,
  })) satisfies ImportRowRecord[];

  const candidateIds = [...new Set(rows.flatMap((row) => row.candidate_movie_ids))];
  const { data: movies } =
    candidateIds.length > 0
      ? await supabase
          .from("movies")
          .select("id, title, year, poster_path, media_type")
          .in("id", candidateIds)
      : { data: [] };
  const candidateById = new Map(
    (movies ?? []).map((movie) => [
      movie.id,
      {
        movieId: movie.id,
        title: movie.title,
        year: movie.year,
        mediaType: movie.media_type,
        posterUrl: movie.poster_path
          ? provider.getImageUrl(movie.poster_path, "w185")
          : null,
      } satisfies CachedImportCandidate,
    ]),
  );

  const active = jobs.some(
    (job) => job.status === "uploading" || job.status === "processing",
  );

  return (
    <Screen>
      <ImportProgressRefresh active={active} />
      <AppHeader
        subtitle="Library imports"
        actions={
          <Link href="/settings" className={navLinkClass}>
            Settings
          </Link>
        }
      />

      <div>
        <p className="t-label text-marquee">Phase 8</p>
        <h1 className="t-display mt-2 text-[clamp(48px,13vw,96px)] text-fg">
          Bring your history
        </h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-fg-dim">
          Import ratings, watched titles, likes, and watchlists. Matches run in
          the background while Venn is open and resume the next time you return.
        </p>
      </div>

      <ImportUpload active={active} />

      {jobs.length > 0 ? (
        <section className="flex flex-col gap-4">
          <h2 className="t-label text-fg-faint">Import history</h2>
          <div className="grid gap-3">
            {jobs.map((job) => {
              const progress = job.total
                ? Math.round((job.processed / job.total) * 100)
                : 0;
              return (
                <Panel key={job.id} className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold uppercase text-fg">{job.source}</p>
                      <p className="mt-1 text-[13px] text-fg-faint">
                        {new Date(job.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="t-label text-marquee">
                      {statusLabel[job.status]}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-ctl bg-surface-2">
                    <div
                      className="h-full bg-marquee transition-[width]"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[14px] text-fg-dim">
                    {job.processed} of {job.total} processed · {job.matched} matched
                  </p>
                  {job.error ? <p className="text-[13px] text-beam-a">{job.error}</p> : null}
                </Panel>
              );
            })}
          </div>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="t-label text-fg-faint">Review unmatched titles</h2>
            <p className="mt-2 text-[15px] text-fg-dim">
              Choose only when the match is right. Dismissing keeps the row in
              import history without changing your library.
            </p>
          </div>
          {rows.map((row) => (
            <ImportReviewRow
              key={row.id}
              row={row}
              candidates={row.candidate_movie_ids.flatMap((id) => {
                const candidate = candidateById.get(id);
                return candidate ? [candidate] : [];
              })}
            />
          ))}
        </section>
      ) : null}
    </Screen>
  );
}
