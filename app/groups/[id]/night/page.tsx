import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { MovieCard } from "@/components/movie-card";
import { parsePresent, PresentPicker, type Member } from "@/components/present-picker";
import { VennMark } from "@/components/venn-mark";
import { explain, type Recommendation } from "@/lib/recommend/explain";
import { provider } from "@/lib/providers";
import { createClient } from "@/lib/supabase/server";

// SPEC §7 screen 6, home mode. Theatre mode is phase 9, and logging the night
// plus its watch confirmations is phase 11 -- so this screen computes and shows,
// and writes nothing.
type MemberRow = {
  user_id: string;
  profiles: { display_name: string | null } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NightPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ present?: string; exclude?: string }>;
};

function nightHref(
  groupId: string,
  present: string[],
  memberIds: string[],
  exclude: string[],
) {
  const params = new URLSearchParams();
  if (present.length !== memberIds.length) params.set("present", present.join(","));
  if (exclude.length > 0) params.set("exclude", exclude.join(","));
  const qs = params.toString();
  return `/groups/${groupId}/night${qs ? `?${qs}` : ""}`;
}

export default async function MovieNightPage({ params, searchParams }: NightPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  // Same gate as the group page: groups_select_member returns nothing to a
  // non-member, so this 404s rather than leaking the group's existence.
  const { data: group } = await supabase
    .from("groups")
    .select("id, name")
    .eq("id", id)
    .single();
  if (!group) notFound();

  const { data: rawMembers } = await supabase
    .from("group_members")
    .select("user_id, profiles(display_name)")
    .eq("group_id", id)
    .order("joined_at", { ascending: true });

  const members: Member[] = ((rawMembers as unknown as MemberRow[] | null) ?? []).map(
    (m) => ({ id: m.user_id, name: m.profiles?.display_name ?? "Member" }),
  );
  const memberIds = members.map((m) => m.id);

  const { present: rawPresent, exclude: rawExclude } = await searchParams;
  // Both come from the URL. `present` is intersected with real members, which
  // also satisfies recommend_movies' own guard; `exclude` only has to be
  // well-formed, since a stray id simply matches no candidate.
  const present = parsePresent(rawPresent, memberIds);
  const exclude = (rawExclude?.split(",") ?? []).filter((v) => UUID.test(v));

  const { data } = present.length
    ? await supabase.rpc("recommend_movies", {
        p_group_id: id,
        p_present: present,
        p_exclude: exclude,
      })
    : { data: null };

  const picks = (data as unknown as Recommendation[] | null) ?? [];

  const rerollHref = nightHref(id, present, memberIds, [
    ...exclude,
    ...picks.map((p) => p.movie_id),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10 sm:px-8">
      <AppHeader
        subtitle={`${group.name} · movie night`}
        actions={
          <>
            <Link href={`/groups/${id}`} className={navLinkClass}>
              Group
            </Link>
            <Link href="/groups" className={navLinkClass}>
              Groups
            </Link>
          </>
        }
      />

      <PresentPicker groupId={id} members={members} present={present} />

      {present.length === 0 ? (
        <Empty
          title="Nobody’s here yet"
          body="Pick who’s watching tonight and the overlap will do the rest."
        />
      ) : picks.length > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-3">
            {picks.map((pick, i) => (
              <div
                key={pick.movie_id}
                className="motion-safe:animate-rise-in"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <MovieCard
                  title={pick.title}
                  year={pick.year}
                  posterUrl={
                    pick.poster_path
                      ? provider.getImageUrl(pick.poster_path, "w342")
                      : null
                  }
                  footer={
                    <ul className="flex flex-col gap-1">
                      {explain(pick).map((reason) => (
                        <li key={reason} className="text-xs text-fg-muted">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  }
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[11px] ${
                      i === 0 ? "bg-overlap text-overlap-fg" : "bg-surface text-fg-muted"
                    }`}
                  >
                    {i + 1}
                  </span>
                </MovieCard>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={rerollHref}
              className="rounded-full bg-overlap px-5 py-2.5 text-sm font-medium text-overlap-fg transition-transform hover:scale-105"
            >
              Reroll
            </Link>
            {exclude.length > 0 ? (
              <Link
                href={nightHref(id, present, memberIds, [])}
                className={navLinkClass}
              >
                Start over
              </Link>
            ) : null}
          </div>
        </>
      ) : (
        <Empty
          title={exclude.length > 0 ? "That’s everything" : "Nothing to pick from"}
          body={
            exclude.length > 0
              ? "You’ve rerolled past every candidate. Start over, or add more to the group list."
              : "Everything on the group list has been seen by someone here. Add a few more and try again."
          }
          action={
            exclude.length > 0 ? (
              <Link
                href={nightHref(id, present, memberIds, [])}
                className="mt-2 rounded-full bg-overlap px-5 py-2.5 text-sm font-medium text-overlap-fg transition-transform hover:scale-105"
              >
                Start over
              </Link>
            ) : (
              <Link
                href={`/groups/${id}`}
                className="mt-2 rounded-full bg-overlap px-5 py-2.5 text-sm font-medium text-overlap-fg transition-transform hover:scale-105"
              >
                Back to the list
              </Link>
            )
          }
        />
      )}
    </main>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20 text-center">
      <VennMark size={40} />
      <div className="space-y-1">
        <p className="text-lg font-medium text-fg">{title}</p>
        <p className="max-w-sm text-sm text-fg-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}
