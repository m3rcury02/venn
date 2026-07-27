import Link from "next/link";
import type { Hype, Rating } from "@/app/status/actions";

export type FilterValue =
  | "all"
  | "watched"
  | "unwatched"
  | "hate"
  | "like"
  | "love"
  | "dont_care"
  | "hyped"
  | "superhyped";

const FILTER_VALUES: FilterValue[] = [
  "all",
  "watched",
  "unwatched",
  "hate",
  "like",
  "love",
  "dont_care",
  "hyped",
  "superhyped",
];

// Unrecognised (or missing) searchParam falls back to "all".
export function parseFilter(raw: string | undefined): FilterValue {
  return FILTER_VALUES.includes(raw as FilterValue) ? (raw as FilterValue) : "all";
}

export type Status = { watched: boolean; rating: Rating | null; hype: Hype | null } | null;

export function matchesFilter(filter: FilterValue, status: Status): boolean {
  const watched = status?.watched ?? false;
  switch (filter) {
    case "all":
      return true;
    case "watched":
      return watched;
    case "unwatched":
      return !watched;
    case "hate":
    case "like":
    case "love":
      return watched && status?.rating === filter;
    case "dont_care":
    case "hyped":
    case "superhyped":
      return !watched && status?.hype === filter;
  }
}

const chipBase = "t-label rounded-ctl px-3 py-2 transition-colors";
const chipInactive = "bg-surface-2 text-fg-dim hover:text-fg";

// A selected value chip lights in its own vote color, matching VoteControl:
// low end `--beam-a`, top end `--beam-b`, middle white. The three structural
// chips (All / Watched / Unwatched) light marquee, because they are navigation
// rather than a value.
function activeToneFor(filter: FilterValue) {
  if (filter === "hate" || filter === "dont_care") return "bg-beam-a text-on-beam";
  if (filter === "love" || filter === "superhyped") return "bg-beam-b text-on-beam";
  if (filter === "like" || filter === "hyped") return "bg-fg text-ink";
  return "bg-marquee text-on-beam";
}

function Chip({
  filter,
  isActive,
  label,
  count,
}: {
  filter: FilterValue;
  isActive: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={filter === "all" ? "/" : `/?filter=${filter}`}
      className={`${chipBase} ${isActive ? activeToneFor(filter) : chipInactive}`}
    >
      {label} <span className="t-data opacity-60">{count}</span>
    </Link>
  );
}

export function ListFilter({ active, statuses }: { active: FilterValue; statuses: Status[] }) {
  const count = (f: FilterValue) => statuses.filter((s) => matchesFilter(f, s)).length;

  // "Watched" and its rating sub-chips share a section; same for "Unwatched"
  // and hype. Selecting a rating/hype value highlights its parent's chip too.
  const inWatchedSection = active === "watched" || active === "hate" || active === "like" || active === "love";
  const inUnwatchedSection =
    active === "unwatched" || active === "dont_care" || active === "hyped" || active === "superhyped";

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Chip filter="all" isActive={active === "all"} label="All" count={statuses.length} />
      <Chip filter="watched" isActive={inWatchedSection} label="Watched" count={count("watched")} />
      <Chip filter="unwatched" isActive={inUnwatchedSection} label="Unwatched" count={count("unwatched")} />

      {inWatchedSection ? (
        <>
          <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
          <Chip filter="love" isActive={active === "love"} label="Loved" count={count("love")} />
          <Chip filter="like" isActive={active === "like"} label="Liked" count={count("like")} />
          <Chip filter="hate" isActive={active === "hate"} label="Hated" count={count("hate")} />
        </>
      ) : null}

      {inUnwatchedSection ? (
        <>
          <span className="mx-1 h-4 w-px bg-hairline" aria-hidden />
          <Chip filter="superhyped" isActive={active === "superhyped"} label="Very hyped" count={count("superhyped")} />
          <Chip filter="hyped" isActive={active === "hyped"} label="Hyped" count={count("hyped")} />
          <Chip filter="dont_care" isActive={active === "dont_care"} label="Meh" count={count("dont_care")} />
        </>
      ) : null}
    </div>
  );
}
