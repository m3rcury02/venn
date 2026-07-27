"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { MovieCard } from "@/components/movie-card";
import { buttonClass } from "@/components/ui/button";
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
    <li className="flex flex-col gap-5 rounded-card border border-hairline bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="t-label text-fg-faint">
            Shared · {source.replace(/_/g, " ")}
          </p>
          <p className="t-body mt-2 line-clamp-3 text-[15px] wrap-anywhere text-fg-dim">
            {rawText}
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => startTransition(() => rejectInboxItem(id))}
          className="t-label shrink-0 rounded-ctl px-3 py-2 text-fg-faint transition-colors hover:bg-surface-2 hover:text-beam-a disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>

      {candidates.length > 0 ? (
        <div className="grid grid-cols-3 gap-3 sm:max-w-md">
          {candidates.map((candidate) => (
            <div
              key={candidate.id}
              className={`flex min-w-0 flex-col transition-opacity ${
                picked && picked !== candidate.id ? "opacity-25" : ""
              }`}
            >
              <MovieCard
                title={candidate.title}
                year={candidate.year}
                href={`/movies/${candidate.id}`}
                posterUrl={candidate.posterUrl}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => pick(candidate.id)}
                className={buttonClass(
                  "ghost",
                  "mt-3 min-h-11 w-full px-2 text-[12px] disabled:cursor-wait",
                )}
              >
                Choose this movie
              </button>
            </div>
          ))}
        </div>
      ) : (
        // The common case, not the edge case: shared Instagram and YouTube text
        // links the post rather than the film, so §5's url branch misses and
        // there is nothing to offer. Hand the user the search screen instead of
        // guessing -- "a silent wrong add is worse than a badge".
        <Link
          href={searchQuery ? `/search?q=${encodeURIComponent(searchQuery)}` : "/search"}
          className={buttonClass("ghost", "self-start")}
        >
          Search for it
        </Link>
      )}
    </li>
  );
}
