"use client";

import { FormEvent, useState, useTransition } from "react";
import {
  applyCachedImportCandidate,
  dismissImportRow,
  resolveImportRow,
  searchImportMovies,
  type ImportSearchResult,
} from "@/app/settings/imports/actions";
import type { Rating } from "@/app/status/actions";
import { MovieCard } from "@/components/movie-card";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

export type CachedImportCandidate = {
  movieId: string;
  title: string;
  year: number | null;
  mediaType: "movie" | "tv";
  posterUrl: string | null;
};

export type ReviewImportRow = {
  id: string;
  title: string;
  year: number | null;
  imdbId: string | null;
  watched: boolean;
  rating: Rating | null;
  error: string | null;
};

export function ImportReviewRow({
  row,
  candidates,
}: {
  row: ReviewImportRow;
  candidates: CachedImportCandidate[];
}) {
  const [results, setResults] = useState<ImportSearchResult[]>([]);
  const [query, setQuery] = useState(row.title);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function applyCached(movieId: string) {
    setMessage(null);
    setPendingId(movieId);
    startTransition(async () => {
      const result = await applyCachedImportCandidate(row.id, movieId);
      if (!result.ok) setMessage(result.error);
      setPendingId(null);
    });
  }

  function applyExternal(externalId: string) {
    setMessage(null);
    setPendingId(externalId);
    startTransition(async () => {
      const result = await resolveImportRow(row.id, externalId);
      if (!result.ok) setMessage(result.error);
      setPendingId(null);
    });
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const matches = await searchImportMovies(row.id, query);
        setResults(matches);
        if (matches.length === 0) setMessage("No matching titles found.");
      } catch {
        setMessage("Search failed. Try again.");
      }
    });
  }

  function dismiss() {
    setMessage(null);
    setPendingId("dismiss");
    startTransition(async () => {
      const result = await dismissImportRow(row.id);
      if (!result.ok) setMessage(result.error);
      setPendingId(null);
    });
  }

  const shown = results.length > 0 ? results : candidates;

  return (
    <Panel className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="t-label text-marquee">Needs a match</p>
          <h3 className="mt-2 text-xl font-semibold text-fg">
            {row.title} {row.year ? `(${row.year})` : ""}
          </h3>
          <p className="mt-1 text-[13px] text-fg-faint">
            {row.imdbId ? `${row.imdbId} · ` : ""}
            {row.watched
              ? row.rating
                ? `Watched · ${row.rating}`
                : "Watched · unrated"
              : "Watchlist"}
          </p>
          {row.error ? <p className="mt-2 text-[13px] text-beam-a">{row.error}</p> : null}
        </div>
        <button
          type="button"
          disabled={isPending}
          onClick={dismiss}
          className={buttonClass("ghost")}
        >
          {pendingId === "dismiss" ? "Dismissing…" : "Dismiss"}
        </button>
      </div>

      <form onSubmit={search} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={`${inputClass} flex-1`}
          aria-label={`Search for ${row.title}`}
        />
        <button type="submit" disabled={isPending || query.trim().length < 2} className={buttonClass()}>
          Search
        </button>
      </form>

      {message ? <p role="status" className="text-[13px] text-beam-a">{message}</p> : null}

      {shown.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {shown.map((movie) => {
            const key = "movieId" in movie ? movie.movieId : movie.externalId;
            return (
              <MovieCard
                key={key}
                title={movie.title}
                year={movie.year}
                posterUrl={movie.posterUrl}
                mediaType={movie.mediaType}
                footer={
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      "movieId" in movie
                        ? applyCached(movie.movieId)
                        : applyExternal(movie.externalId)
                    }
                    className={buttonClass("ghost", "w-full px-2 text-[12px]")}
                  >
                    {pendingId === key ? "Applying…" : "Use this title"}
                  </button>
                }
              />
            );
          })}
        </div>
      ) : null}
    </Panel>
  );
}
