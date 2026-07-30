import Link from "next/link";
import { LinkPending } from "@/components/ui/link-pending";

// SPEC §4: the recommender runs on members marked present. Which members those
// are is a searchParam rather than component state, exactly as
// components/list-filter.tsx holds the list filter -- server-rendered, no
// client JS, and the resulting URL is shareable with the rest of the group.
//
// Toggling presence drops `exclude`: once the group changes, the previous three
// picks are no longer the previous three of anything.

export type Member = { id: string; name: string };

// Phase 9: which candidate pool the night page reads from. Defined here,
// rather than in night-mode-picker.tsx, because this file is already the
// night page's URL-state helper and PresentPicker's own hrefFor needs it below.
export type NightMode = "home" | "theatre";

// Absent param means everyone is present. An empty one means nobody is -- which
// is why this cannot just be `?.split(",") ?? all`.
export function parsePresent(raw: string | undefined, memberIds: string[]): string[] {
  if (raw === undefined) return memberIds;
  const asked = new Set(raw.split(",").filter(Boolean));
  return memberIds.filter((id) => asked.has(id));
}

// These are the one place in the app that stays round. Corners are square
// everywhere else; circles are reserved for the mark and for things that
// stand for people -- which is exactly what a present chip is.
const chipBase = "t-label relative rounded-full px-4 py-2 transition-colors";
const chipOn = "bg-marquee text-on-beam";
const chipOff = "border border-hairline text-fg-dim hover:border-fg-dim hover:text-fg";

export function PresentPicker({
  groupId,
  members,
  present,
  mode,
}: {
  groupId: string;
  members: Member[];
  present: string[];
  /** Carried through so toggling presence doesn't silently drop back to home
   *  mode. Omitted from home mode's URL, same as `present` when everyone's here. */
  mode?: NightMode;
}) {
  const here = new Set(present);

  function hrefFor(next: string[]) {
    const params = new URLSearchParams();
    // All present is the default, so it needs no param.
    if (next.length !== members.length) params.set("present", next.join(","));
    if (mode === "theatre") params.set("mode", mode);
    const qs = params.toString();
    return `/groups/${groupId}/night${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="t-label text-fg-faint">Who&rsquo;s here</h2>
      <div className="flex flex-wrap items-center gap-2">
        {members.map((member) => {
          const isHere = here.has(member.id);
          const next = isHere
            ? present.filter((id) => id !== member.id)
            : members.filter((m) => here.has(m.id) || m.id === member.id).map((m) => m.id);
          return (
            <Link
              key={member.id}
              href={hrefFor(next)}
              aria-pressed={isHere}
              className={`${chipBase} ${isHere ? chipOn : chipOff}`}
            >
              {member.name}
              {/* Toggling presence re-runs recommend_movies, which is the
                  slowest query in the app -- this is the tap that most needed
                  an answer. */}
              <LinkPending size={14} />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
