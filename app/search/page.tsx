import Link from "next/link";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { SearchForm } from "@/components/search-form";
import { createClient } from "@/lib/supabase/server";

type SearchPageProps = {
  searchParams: Promise<{ list?: string }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const listId = (await searchParams).list;

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
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-10 sm:px-8">
      <AppHeader
        subtitle={
          target ? `Adding to ${target.name}` : "Add something to the overlap"
        }
        actions={
          target ? (
            <Link href={`/groups/${target.groupId}`} className={navLinkClass}>
              Back to group
            </Link>
          ) : (
            <Link href="/" className={navLinkClass}>
              My list
            </Link>
          )
        }
      />

      <SearchForm listId={target?.id} />
    </main>
  );
}
