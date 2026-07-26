import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();

  // getClaims() verifies the JWT signature; never trust getSession() here.
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  // Both reads go through RLS as the signed-in user, so rendering them is the
  // end-to-end proof that the policies and grants line up.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, region, default_list_visibility")
    .single();

  const { data: lists } = await supabase
    .from("lists")
    .select("id, name, is_default, visibility");

  return (
    <main className="flex flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Venn</h1>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="h-9 rounded-lg border border-zinc-300 px-3 text-sm dark:border-zinc-700"
          >
            Sign out
          </button>
        </form>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Signed in as {String(data.claims.email)}
      </p>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Profile</h2>
        <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 text-xs dark:bg-zinc-900">
          {JSON.stringify(profile, null, 2)}
        </pre>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Lists</h2>
        <pre className="overflow-x-auto rounded-lg bg-zinc-100 p-4 text-xs dark:bg-zinc-900">
          {JSON.stringify(lists, null, 2)}
        </pre>
      </section>
    </main>
  );
}
