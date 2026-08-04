import Link from "next/link";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { UserSearchForm } from "@/components/user-search-form";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
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

export default async function DiscoverPage() {
  const supabase = await createClient();

  const { data: rawLists } = await supabase
    .from("lists")
    .select("id, name, owner_user_id, profiles!lists_owner_user_id_fkey(username, display_name)")
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(20);

  const lists = (rawLists ?? []) as unknown as PublicListRow[];

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

      <footer className="mt-4">
        <p className="t-body text-[14px] text-fg-faint">
          Public group browsing lands in Phase 12.
        </p>
      </footer>
    </Screen>
  );
}
