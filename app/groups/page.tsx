import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { CreateGroupForm } from "@/components/create-group-form";
import { DisplayNameForm } from "@/components/display-name-form";
import { JoinGroupForm } from "@/components/join-group-form";
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

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", data.claims.sub)
    .single();

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
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-10 sm:px-8">
      <AppHeader
        subtitle={
          groups.length > 0
            ? `Groups · ${groups.length}`
            : "Where your lists overlap"
        }
        actions={
          <>
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
            <Link href="/search" className={navLinkClass}>
              Search
            </Link>
          </>
        }
      />

      {groups.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {groups.map((m, i) => (
            <li
              key={m.groups.id}
              className="motion-safe:animate-rise-in"
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
            >
              <Link
                href={`/groups/${m.groups.id}`}
                className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 transition-colors hover:bg-surface-strong"
              >
                <VennMark size={20} />
                <span className="flex-1 truncate text-sm font-medium text-fg">
                  {m.groups.name}
                </span>
                <span className="font-mono text-[10px] tracking-wider text-fg-faint uppercase">
                  {m.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <VennMark size={36} />
          <p className="max-w-sm text-sm text-fg-muted">
            No groups yet. Start one and share the code, or paste a code someone
            sent you.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6 border-t border-surface-strong pt-8">
        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[11px] tracking-wider text-fg-faint uppercase">
            Start a group
          </h2>
          <CreateGroupForm />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="font-mono text-[11px] tracking-wider text-fg-faint uppercase">
            Join with a code
          </h2>
          <JoinGroupForm />
        </section>

        <section>
          <DisplayNameForm current={profile?.display_name ?? null} />
        </section>
      </div>
    </main>
  );
}
