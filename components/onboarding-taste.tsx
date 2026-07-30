"use client";

import { useState, useTransition } from "react";
import {
  completeOnboarding,
  loadPopularOnboarding,
  rateOnboardingMovie,
  type OnboardingMovie,
} from "@/app/onboarding/actions";
import type { Rating } from "@/app/status/actions";
import { MovieCard } from "@/components/movie-card";
import { buttonClass } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const choices: { value: Rating; label: string; active: string }[] = [
  { value: "hate", label: "Not for me", active: "border-beam-a bg-beam-a text-on-beam" },
  { value: "like", label: "Liked", active: "border-fg bg-fg text-ink" },
  { value: "love", label: "Loved", active: "border-beam-b bg-beam-b text-on-beam" },
];

const choiceBase =
  "flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-ctl border px-1 text-center text-[9px] font-semibold uppercase leading-tight tracking-[0.03em] transition-colors disabled:pointer-events-none";

export function OnboardingTaste({
  initialMovies,
  initialCount,
}: {
  initialMovies: OnboardingMovie[];
  initialCount: number;
}) {
  const [movies, setMovies] = useState(initialMovies);
  const [count, setCount] = useState(initialCount);
  const [page, setPage] = useState(1);
  const [pendingMovie, setPendingMovie] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function rate(externalId: string, rating: Rating) {
    setMessage(null);
    setPendingMovie(externalId);
    startTransition(async () => {
      const result = await rateOnboardingMovie(externalId, rating);
      if (result.ok) {
        setMovies((current) =>
          current.map((movie) =>
            movie.externalId === externalId ? { ...movie, rating } : movie,
          ),
        );
        setCount(result.count);
      } else {
        setMessage(result.message ?? "Couldn't save that rating.");
      }
      setPendingMovie(null);
    });
  }

  function loadMore() {
    setMessage(null);
    startTransition(async () => {
      try {
        const nextPage = page + 1;
        const next = await loadPopularOnboarding(nextPage);
        setMovies((current) => {
          const seen = new Set(current.map((movie) => movie.externalId));
          return [...current, ...next.filter((movie) => !seen.has(movie.externalId))];
        });
        setPage(nextPage);
      } catch {
        setMessage("Couldn't load more movies.");
      }
    });
  }

  function finish() {
    setMessage(null);
    startTransition(async () => {
      const result = await completeOnboarding();
      if (result?.error) setMessage(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="sticky top-0 z-20 -mx-5 border-y border-hairline bg-ink/95 px-5 py-4 backdrop-blur sm:mx-0 sm:border-x">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="t-label text-fg-faint">Taste profile</p>
            <p className="mt-1 text-[15px] text-fg">
              {Math.min(count, 10)} / 10 rated
            </p>
          </div>
          {count >= 10 ? (
            <button
              type="button"
              onClick={finish}
              disabled={isPending}
              className={buttonClass()}
            >
              {isPending && !pendingMovie ? <Spinner /> : "Enter Venn"}
            </button>
          ) : (
            <p className="max-w-52 text-right text-[13px] text-fg-dim">
              Rate movies you&rsquo;ve seen. Load more whenever none fit.
            </p>
          )}
        </div>
      </div>

      {message ? (
        <p role="alert" className="text-[14px] text-beam-a">
          {message}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4 lg:grid-cols-5">
        {movies.map((movie) => (
          <MovieCard
            key={movie.externalId}
            title={movie.title}
            year={movie.year}
            posterUrl={movie.posterUrl}
            footer={
              <div className="flex items-stretch gap-1">
                {choices.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    disabled={isPending}
                    aria-pressed={movie.rating === choice.value}
                    onClick={() => rate(movie.externalId, choice.value)}
                    className={`${choiceBase} ${
                      movie.rating === choice.value
                        ? choice.active
                        : "border-hairline bg-surface-2 text-fg hover:border-fg-dim"
                    }`}
                  >
                    {pendingMovie === movie.externalId ? (
                      <Spinner />
                    ) : (
                      choice.label
                    )}
                  </button>
                ))}
              </div>
            }
          />
        ))}
      </div>

      <button
        type="button"
        onClick={loadMore}
        disabled={isPending}
        className={buttonClass("ghost", "self-center")}
      >
        {isPending && !pendingMovie ? <Spinner /> : "Load more movies"}
      </button>
    </div>
  );
}
