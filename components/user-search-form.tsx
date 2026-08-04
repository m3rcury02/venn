"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { searchUsers, type UserSearchResult } from "@/app/discover/actions";
import { errorClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

const DEBOUNCE_MS = 300;

export function UserSearchForm() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      if (query.trim().length < 2) {
        setResults([]);
        setIsSearching(false);
        setError(false);
        return;
      }
      setIsSearching(true);
      setError(false);
      searchUsers(query)
        .then((found) => {
          if (id === requestId.current) {
            setResults(found);
            setIsSearching(false);
          }
        })
        .catch(() => {
          if (id === requestId.current) {
            setIsSearching(false);
            setError(true);
          }
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = query.trim();
  const showEmpty = !isSearching && !error && trimmed.length >= 2 && results.length === 0;

  return (
    <div className="flex flex-col gap-6">
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
            placeholder="Search users by name or @username…"
            className="h-14 w-full rounded-ctl bg-transparent px-5 text-[17px] text-fg placeholder:text-fg-faint focus:outline-none"
          />
        </div>
      </div>

      {isSearching ? <p className="t-label text-fg-faint">Searching…</p> : null}

      {error ? (
        <p className={errorClass}>Search failed. Try again in a moment.</p>
      ) : null}

      {showEmpty ? (
        <p className="t-body text-fg-dim">No users found matching &ldquo;{trimmed}&rdquo;.</p>
      ) : null}

      {results.length > 0 ? (
        <div className="flex flex-col gap-2">
          {results.map((user) => {
            const displayName = user.display_name || user.username || "User";
            const initial = displayName[0]?.toUpperCase() ?? "U";
            const linkHref = user.username ? `/u/${user.username}` : "#";

            return (
              <Link key={user.id} href={linkHref}>
                <Panel className="flex items-center gap-4 transition hover:border-fg-dim">
                  {user.avatar_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- plain img hotlinking as required by Phase 10 rules */
                    <img
                      src={user.avatar_url}
                      alt={displayName}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-beam-a/20 font-display text-[18px] font-bold text-beam-a">
                      {initial}
                    </div>
                  )}

                  <div className="flex flex-col">
                    <span className="font-display text-[16px] font-medium text-fg">
                      {displayName}
                    </span>
                    {user.username ? (
                      <span className="t-body text-[14px] text-fg-dim">
                        @{user.username}
                      </span>
                    ) : null}
                  </div>
                </Panel>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
