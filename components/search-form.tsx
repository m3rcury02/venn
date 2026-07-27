"use client";

import { useEffect, useRef, useState } from "react";
import { searchMovies, type SearchResult } from "@/app/search/actions";
import { AddToListButton } from "@/components/add-to-list-button";
import { MovieCard } from "@/components/movie-card";

const DEBOUNCE_MS = 300;

export function SearchForm({
  listId,
  initialQuery,
}: {
  listId?: string;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Guards against a slow earlier response overwriting a newer one.
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      setIsSearching(true);
      searchMovies(query).then((found) => {
        if (id === requestId.current) {
          setResults(found);
          setIsSearching(false);
        }
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = query.trim();
  const showEmpty = !isSearching && trimmed.length >= 2 && results.length === 0;

  return (
    <div className="flex flex-col gap-8">
      {/* The field is lit from both beams -- a 1.5px gradient edge that gains
          its own spill on focus. Square, like everything that isn't a person. */}
      <div
        className="rounded-ctl p-[1.5px] transition-shadow duration-300 focus-within:shadow-[0_0_38px_-8px_var(--beam-a)]"
        style={{
          background: "linear-gradient(100deg, var(--beam-a), var(--beam-b))",
        }}
      >
        <div className="rounded-ctl bg-ink">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search movies…"
            autoFocus
            className="h-14 w-full rounded-ctl bg-transparent px-5 text-[17px] text-fg placeholder:text-fg-faint focus:outline-none"
          />
        </div>
      </div>

      {isSearching ? <p className="t-label text-fg-faint">Searching…</p> : null}

      {showEmpty ? (
        <p className="t-body text-[15px] text-fg-dim">
          No matches for &ldquo;{trimmed}&rdquo;.
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {results.map((movie, i) => (
          <div
            key={movie.externalId}
            className="motion-safe:animate-expose"
            style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
          >
            <MovieCard title={movie.title} year={movie.year} posterUrl={movie.posterUrl}>
              <AddToListButton externalId={movie.externalId} listId={listId} />
            </MovieCard>
          </div>
        ))}
      </div>
    </div>
  );
}
