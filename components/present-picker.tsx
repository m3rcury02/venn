import Link from "next/link";

// SPEC §4: the recommender runs on members marked present. Which members those
// are is a searchParam rather than component state, exactly as
// components/list-filter.tsx holds the list filter -- server-rendered, no
// client JS, and the resulting URL is shareable with the rest of the group.
//
// Toggling presence drops `exclude`: once the group changes, the previous three
// picks are no longer the previous three of anything.

export type Member = { id: string; name: string };

// Absent param means everyone is present. An empty one means nobody is -- which
// is why this cannot just be `?.split(",") ?? all`.
export function parsePresent(raw: string | undefined, memberIds: string[]): string[] {
  if (raw === undefined) return memberIds;
  const asked = new Set(raw.split(",").filter(Boolean));
  return memberIds.filter((id) => asked.has(id));
}

const chipBase =
  "rounded-full px-3 py-1.5 text-xs font-medium tracking-wide transition-colors";
const chipOn = "bg-overlap text-overlap-fg";
const chipOff = "bg-surface text-fg-muted hover:text-fg";

export function PresentPicker({
  groupId,
  members,
  present,
}: {
  groupId: string;
  members: Member[];
  present: string[];
}) {
  const here = new Set(present);

  function hrefFor(next: string[]) {
    const base = `/groups/${groupId}/night`;
    // All present is the default, so it needs no param.
    if (next.length === members.length) return base;
    return `${base}?present=${next.join(",")}`;
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="font-mono text-[11px] tracking-wider text-fg-faint uppercase">
        Who&rsquo;s here
      </h2>
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
            </Link>
          );
        })}
      </div>
    </div>
  );
}
