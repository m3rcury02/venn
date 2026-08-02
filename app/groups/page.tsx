import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { GroupActionsFab } from "@/components/group-actions-fab";
import { Screen } from "@/components/ui/screen";
import { VennMark } from "@/components/venn-mark";
import { createClient } from "@/lib/supabase/server";

// No generated database.types.ts (see docs/DECISIONS.md phase 1a), so the
// embed's cardinality is declared here. group_members.group_id -> groups.id is
// many-to-one, which postgrest-js types as an array without those types.
type MembershipRow = {
  role: string;
  groups: { id: string; name: string };
};

export default async function GroupsPage() {
  const supabase = await createClient();

  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  // Scoped to user_id: group_members_select_peers returns every member of every
  // group the caller is in, so without this the group appears once per member.
  const { data: rawMemberships } = await supabase
    .from("group_members")
    .select("role, groups(id, name)")
    .eq("user_id", data.claims.sub)
    .order("joined_at", { ascending: true });

  const memberships = rawMemberships as unknown as MembershipRow[] | null;
  const groups = memberships ?? [];

  return (
    <Screen width="narrow" className="pb-28 sm:pb-24">
      <AppHeader
        subtitle={
          groups.length > 0
            ? `${groups.length} group${groups.length === 1 ? "" : "s"}`
            : "Where your lists overlap"
        }
        actions={
          <>
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
            <Link href="/explore" className={navLinkClass}>
              Explore
            </Link>
            <Link href="/search" className={navLinkClass}>
              Search
            </Link>
          </>
        }
      />

      <h1 className="t-display text-[clamp(44px,13vw,96px)] text-fg">Your groups</h1>

      {groups.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {groups.map((m, i) => (
            <li
              key={m.groups.id}
              className="motion-safe:animate-expose"
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
            >
              <Link
                href={`/groups/${m.groups.id}`}
                className="flex items-center gap-3.5 rounded-card border border-hairline bg-surface px-4 py-4 transition-colors hover:border-fg-dim"
              >
                <VennMark size={22} />
                <span className="flex-1 truncate text-[15px] font-semibold text-fg">
                  {m.groups.name}
                </span>
                <span className="t-label text-fg-faint">{m.role}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <VennMark size={40} />
          <p className="t-body max-w-sm text-[15px] text-fg-dim">
            No groups yet. Tap New group to start one and share the code, or
            join with a code someone sent you.
          </p>
        </div>
      )}

      <GroupActionsFab />
    </Screen>
  );
}
