import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import type { Status } from "@/components/list-filter";
import { InviteCode } from "@/components/invite-code";
import { MovieCard } from "@/components/movie-card";
import { RemoveFromListButton } from "@/components/remove-from-list-button";
import { VennMark } from "@/components/venn-mark";
import { VoteControl } from "@/components/vote-control";
import { WatchedToggle } from "@/components/watched-toggle";
import { provider } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

// Same reason as app/page.tsx: with no generated database.types.ts,
// postgrest-js types every embed as an array. movies and profiles are
// many-to-one from list_items' side and come back as objects;
// user_movie_status is genuinely to-many (0 or 1 row per caller, RLS-scoped).
type GroupItemRow = {
  movie_id: string;
  movies: {
    title: string;
    year: number | null;
    poster_path: string | null;
    user_movie_status: Status[];
  };
  profiles: { display_name: string | null } | null;
};

type MemberRow = {
  user_id: string;
  role: string;
  profiles: { display_name: string | null } | null;
};

type GroupPageProps = {
  params: Promise<{ id: string }>;
};

export default async function GroupPage({ params }: GroupPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  // groups_select_member is the gate: a non-member gets no row at all, so this
  // 404s rather than leaking the group's name or its invite code.
  const { data: group } = await supabase
    .from("groups")
    .select("id, name, invite_code")
    .eq("id", id)
    .single();
  if (!group) notFound();

  const { data: rawMembers } = await supabase
    .from("group_members")
    .select("user_id, role, profiles(display_name)")
    .eq("group_id", id)
    .order("joined_at", { ascending: true });
  const members = (rawMembers as unknown as MemberRow[] | null) ?? [];

  const { data: list } = await supabase
    .from("lists")
    .select("id")
    .eq("owner_group_id", id)
    .single();

  const { data: rawItems } = list
    ? await supabase
        .from("list_items")
        .select(
          "movie_id, added_at, movies(title, year, poster_path, user_movie_status(watched, rating, hype)), profiles(display_name)",
        )
        .eq("list_id", list.id)
        .order("added_at", { ascending: false })
    : { data: null };

  const items = (rawItems as unknown as GroupItemRow[] | null) ?? [];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10 sm:px-8">
      <AppHeader
        subtitle={`${group.name} · ${items.length} movie${items.length === 1 ? "" : "s"}`}
        actions={
          <>
            <Link href="/groups" className={navLinkClass}>
              Groups
            </Link>
            <Link href={`/groups/${id}/night`} className={navLinkClass}>
              Movie night
            </Link>
            {list ? (
              <Link href={`/search?list=${list.id}`} className={navLinkClass}>
                Add movies
              </Link>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <InviteCode code={group.invite_code} />
        <ul className="flex flex-wrap items-center gap-2">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="rounded-full bg-surface px-3 py-1 text-xs text-fg-muted"
            >
              {m.profiles?.display_name ?? "Member"}
              {m.role === "owner" ? (
                <span className="ml-1.5 text-fg-faint">· owner</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {items.map((item, i) => {
            const status = item.movies.user_movie_status[0] ?? null;
            const watched = status?.watched ?? false;
            return (
              <div
                key={item.movie_id}
                className="motion-safe:animate-rise-in"
                style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
              >
                <MovieCard
                  title={item.movies.title}
                  year={item.movies.year}
                  posterUrl={
                    item.movies.poster_path
                      ? provider.getImageUrl(item.movies.poster_path, "w185")
                      : null
                  }
                  footer={
                    <div className="flex flex-col gap-1.5">
                      <p className="truncate font-mono text-[10px] tracking-wider text-fg-faint uppercase">
                        added by {item.profiles?.display_name ?? "Member"}
                      </p>
                      <VoteControl
                        movieId={item.movie_id}
                        watched={watched}
                        rating={status?.rating ?? null}
                        hype={status?.hype ?? null}
                      />
                    </div>
                  }
                >
                  <div className="flex gap-1">
                    <WatchedToggle movieId={item.movie_id} watched={watched} />
                    {list ? (
                      <RemoveFromListButton
                        movieId={item.movie_id}
                        listId={list.id}
                      />
                    ) : null}
                  </div>
                </MovieCard>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
          <VennMark size={40} />
          <div className="space-y-1">
            <p className="text-lg font-medium text-fg">Nothing here yet</p>
            <p className="max-w-sm text-sm text-fg-muted">
              Share the code above, then start adding — this list is where
              everyone&rsquo;s circles meet.
            </p>
          </div>
          {list ? (
            <Link
              href={`/search?list=${list.id}`}
              className="mt-2 rounded-full bg-overlap px-5 py-2.5 text-sm font-medium text-overlap-fg transition-transform hover:scale-105"
            >
              Add movies
            </Link>
          ) : null}
        </div>
      )}
    </main>
  );
}
