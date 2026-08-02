import Link from "next/link";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { SearchForm } from "@/components/search-form";
import { Screen } from "@/components/ui/screen";
import { createClient } from "@/lib/supabase/server";

type SearchPageProps = {
  searchParams: Promise<{ list?: string; q?: string }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  // `q` prefills the box. The Inbox uses it for shares that produced no
  // candidate to offer, which §5 makes the common case rather than the edge one.
  const { list: listId, q } = await searchParams;

  // Resolve the target only to name it in the header. The add itself does not
  // trust listId either -- list_items_insert_via_list is the enforcement.
  let target: { id: string; name: string; groupId: string } | null = null;
  if (listId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("lists")
      .select("id, name, owner_group_id")
      .eq("id", listId)
      .not("owner_group_id", "is", null)
      .single();
    if (data) {
      target = { id: data.id, name: data.name, groupId: data.owner_group_id };
    }
  }

  return (
    <Screen>
      <AppHeader
        subtitle={target ? `Adding to ${target.name}` : "Add something to the overlap"}
        actions={
          target ? (
            <Link href={`/groups/${target.groupId}`} className={navLinkClass}>
              Back to group
            </Link>
          ) : (
            <>
              <Link href="/" className={navLinkClass}>
                My list
              </Link>
              <Link href="/explore" className={navLinkClass}>
                Explore
              </Link>
            </>
          )
        }
        mobileActions={
          target ? (
            <Link href={`/groups/${target.groupId}`} className={navLinkClass}>
              Back to group
            </Link>
          ) : null
        }
      />

      <h1 className="t-display text-[clamp(44px,13vw,104px)] text-fg">
        {target ? "Add to the group" : "Find it"}
      </h1>

      <SearchForm listId={target?.id} initialQuery={q} />
    </Screen>
  );
}
