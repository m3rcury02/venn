"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MovieCard } from "@/components/movie-card";
import { rejectInboxItem, resolveInboxItem } from "@/app/inbox/actions";

export type InboxCandidate = {
  id: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
};

type InboxItemProps = {
  id: string;
  rawText: string;
  source: string;
  candidates: InboxCandidate[];
  /**
   * Prefills /search when there is nothing to offer. Computed server-side, and
   * undefined when the extractor found no title worth guessing at -- in that
   * case the box opens empty and focused, which is faster to type into than one
   * the user has to clear first.
   */
  searchQuery?: string;
};

export function InboxItem({
  id,
  rawText,
  source,
  candidates,
  searchQuery,
}: InboxItemProps) {
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string | null>(null);

  function pick(movieId: string) {
    setPicked(movieId);
    startTransition(() => resolveInboxItem(id, movieId));
  }

  return (
    <li className="flex flex-col gap-4 rounded-2xl bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-wider text-fg-faint uppercase">
            Shared · {source.replace(/_/g, " ")}
          </p>
          <p className="mt-1 line-clamp-3 text-sm wrap-anywhere text-fg-muted">
            {rawText}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => rejectInboxItem(id))}
          className="shrink-0 rounded-full px-3 py-1.5 font-mono text-[10px] tracking-wider text-fg-faint uppercase transition-colors hover:bg-surface-strong hover:text-circle-a disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>

      {candidates.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 sm:max-w-md">
          {candidates.map((candidate) => (
            <button
              key={candidate.id}
              type="button"
              disabled={pending}
              onClick={() => pick(candidate.id)}
              className={`rounded-2xl text-left transition-opacity disabled:cursor-wait ${
                picked && picked !== candidate.id ? "opacity-30" : ""
              }`}
            >
              <MovieCard
                title={candidate.title}
                year={candidate.year}
                posterUrl={candidate.posterUrl}
              />
            </button>
          ))}
        </div>
      ) : (
        // The common case, not the edge case: shared Instagram and YouTube text
        // links the post rather than the film, so §5's url branch misses and
        // there is nothing to offer. Hand the user the search screen instead of
        // guessing -- "a silent wrong add is worse than a badge".
        <Link
          href={
            searchQuery ? `/search?q=${encodeURIComponent(searchQuery)}` : "/search"
          }
          className="self-start rounded-full bg-surface-strong px-4 py-2 text-sm text-fg transition-transform hover:scale-105"
        >
          Search for it
        </Link>
      )}
    </li>
  );
}
