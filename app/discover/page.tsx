import Link from "next/link";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { JoinPublicGroupButton } from "@/components/join-public-group-button";
import { buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { UserSearchForm } from "@/components/user-search-form";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

type PublicListRow = {
  id: string;
  name: string;
  owner_user_id: string | null;
  profiles: {
    username: string | null;
    display_name: string | null;
  } | null;
};

type PublicGroupRow = {
  id: string;
  name: string;
  member_count: number | string;
  created_at: string;
};

export default async function DiscoverPage() {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;

  const [{ data: rawLists }, { data: rawGroups, error: groupsError }, { data: myMemberships }] =
    await Promise.all([
      supabase
        .from("lists")
        .select("id, name, owner_user_id, profiles!lists_owner_user_id_fkey(username, display_name)")
        .eq("visibility", "public")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.rpc("public_groups", { p_limit: 20 }),
      typeof userId === "string"
        ? supabase.from("group_members").select("group_id").eq("user_id", userId)
        : Promise.resolve({ data: [] }),
    ]);

  const lists = (rawLists ?? []) as unknown as PublicListRow[];
  const groups = (groupsError ? [] : (rawGroups ?? [])) as unknown as PublicGroupRow[];
  const memberGroupIds = new Set((myMemberships ?? []).map((m) => m.group_id));

  return (
    <Screen>
      <AppHeader
        subtitle="Discover"
        actions={
          <>
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
            <Link href="/groups" className={navLinkClass}>
              Groups
            </Link>
          </>
        }
      />

      <h1 className="t-display text-[clamp(44px,13vw,96px)] text-fg">Discover</h1>

      <section className="flex flex-col gap-4">
        <h2 className="t-label text-fg-faint">Find users</h2>
        <UserSearchForm />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="t-label text-fg-faint">Public lists</h2>

        {lists.length === 0 ? (
          <Panel>
            <p className="t-body text-fg-dim">No public lists found.</p>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((list) => {
              const username = list.profiles?.username;
              const displayName = list.profiles?.display_name || username || "User";
              const href = username ? `/u/${username}` : "#";

              return (
                <Link key={list.id} href={href}>
                  <Panel className="flex flex-col gap-1 transition hover:border-fg-dim">
                    <span className="font-display text-[17px] font-medium text-fg">
                      {displayName}
                    </span>
                    {username ? (
                      <span className="t-body text-[14px] text-fg-dim">
                        @{username}
                      </span>
                    ) : null}
                  </Panel>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="t-label text-fg-faint">Public groups</h2>

        {groups.length === 0 ? (
          <Panel>
            <p className="t-body text-fg-dim">No public groups found.</p>
          </Panel>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => {
              const memberCount = Number(group.member_count) || 0;
              const isMember = memberGroupIds.has(group.id);

              return (
                <Panel key={group.id} className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <span className="font-display text-[17px] font-medium text-fg truncate">
                      {group.name}
                    </span>
                    <span className="t-label text-fg-faint">
                      {memberCount} member{memberCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  {isMember ? (
                    <Link href={`/groups/${group.id}`} className={buttonClass("ghost")}>
                      Open
                    </Link>
                  ) : (
                    <JoinPublicGroupButton groupId={group.id} />
                  )}
                </Panel>
              );
            })}
          </div>
        )}
      </section>
    </Screen>
  );
}
