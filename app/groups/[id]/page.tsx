import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdSlot } from "@/components/ad-slot";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { DeleteGroupPanel } from "@/components/delete-group-panel";
import { GroupVisibilityPanel } from "@/components/group-visibility-panel";
import type { Status } from "@/components/list-filter";
import { InviteCode } from "@/components/invite-code";
import { LeaveGroupPanel } from "@/components/leave-group-panel";
import { MovieCard } from "@/components/movie-card";
import { RemoveFromListButton } from "@/components/remove-from-list-button";
import { ReportButton } from "@/components/report-button";
import { buttonClass } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { Screen } from "@/components/ui/screen";
import { VennMark } from "@/components/venn-mark";
import { VoteControl } from "@/components/vote-control";
import { WatchedToggle } from "@/components/watched-toggle";
import { provider } from "@/lib/providers";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

// Same reason as app/page.tsx: with no generated database.types.ts,
// postgrest-js types every embed as an array. movies and profiles are
// many-to-one from list_items' side and come back as objects;
// user_movie_status is genuinely to-many (0 or 1 row per caller, RLS-scoped).
type GroupItemRow = {
  movie_id: string;
  added_by: string;
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

  const { data: claims } = await getClaims(supabase);
  if (!claims?.claims) redirect("/login");

  // group, group_members, and lists are all independent reads keyed on id --
  // run them together rather than serially. Only list_items below actually
  // depends on list.
  const [{ data: group }, { data: rawMembers }, { data: list }] = await Promise.all([
    // groups_select_member is the gate: a non-member gets no row at all, so
    // this 404s rather than leaking the group's name or its invite code.
    supabase
      .from("groups")
      .select("id, name, invite_code, created_by, visibility")
      .eq("id", id)
      .single(),
    supabase
      .from("group_members")
      .select("user_id, role, profiles(display_name)")
      .eq("group_id", id)
      .order("joined_at", { ascending: true }),
    supabase
      .from("lists")
      .select("id")
      .eq("owner_group_id", id)
      .single(),
  ]);
  if (!group) notFound();
  const members = (rawMembers as unknown as MemberRow[] | null) ?? [];

  // PostgREST returns at most max_rows (1000, supabase/config.toml) rows. A
  // public group's list can be longer, so ask for the true count alongside
  // and say when the grid is showing only the newest part of it. The movie
  // night picker reads the list in SQL and isn't capped.
  const { data: rawItems, count: totalItems } = list
    ? await supabase
        .from("list_items")
        .select(
          "movie_id, added_by, added_at, movies(title, year, poster_path, user_movie_status(watched, rating, hype)), profiles(display_name)",
          { count: "exact" },
        )
        .eq("list_id", list.id)
        .order("added_at", { ascending: false })
    : { data: null, count: null };

  const items = (rawItems as unknown as GroupItemRow[] | null) ?? [];
  const total = totalItems ?? items.length;

  return (
    <Screen>
      <AppHeader
        subtitle={`${total} movie${total === 1 ? "" : "s"}`}
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
        mobileActions={
          <>
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

      <div>
        <h1 className="t-display text-[clamp(40px,12vw,96px)] text-fg">{group.name}</h1>
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <InviteCode code={group.invite_code} />
          {/* Round, because these stand for people -- the one exception to the
              square-corner rule (see globals.css). */}
          <ul className="flex flex-wrap items-center gap-2">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="t-label rounded-full border border-hairline px-3.5 py-1.5 text-fg-dim"
              >
                {m.profiles?.display_name ?? "Member"}
                {m.role === "owner" ? (
                  <span className="ml-1.5 text-marquee">· owner</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {items.length > 0 ? (
        <>
          <AdSlot slot="group-list-top" />
          {total > items.length ? (
            <p className="t-label text-fg-faint">
              Showing the newest {items.length} of {total}. Movie night still picks from all of them.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {items.map((item, i) => {
              const status = item.movies.user_movie_status[0] ?? null;
              const watched = status?.watched ?? false;
              return (
                <Reveal key={item.movie_id} index={i}>
                  <MovieCard
                    title={item.movies.title}
                    year={item.movies.year}
                    href={`/movies/${item.movie_id}`}
                    posterUrl={
                      item.movies.poster_path
                        ? provider.getImageUrl(item.movies.poster_path, "w342")
                        : null
                    }
                    footer={
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="t-label truncate text-fg-faint">
                            added by {item.profiles?.display_name ?? "Member"}
                          </p>
                          {list ? (
                            <ReportButton
                              targetType="list_item"
                              targetId={list.id}
                              targetMovieId={item.movie_id}
                              label="Report"
                              className="t-label text-[10px] text-fg-faint hover:text-fg"
                            />
                          ) : null}
                        </div>
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
                      {/* Mirrors list_items_delete_via_list: only the adder or
                          the group's creator can remove an item, so nobody
                          else is shown a button that would do nothing. */}
                      {list &&
                      (item.added_by === claims.claims.sub ||
                        group.created_by === claims.claims.sub) ? (
                        <RemoveFromListButton movieId={item.movie_id} listId={list.id} />
                      ) : null}
                    </div>
                  </MovieCard>
                </Reveal>
              );
            })}
          </div>
          <AdSlot slot="group-list-bottom" />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-20 text-center">
          <VennMark size={44} />
          <p className="t-section text-3xl text-fg">Nothing here yet</p>
          <p className="t-body max-w-sm text-[15px] text-fg-dim">
            Share the code above, then start adding — this list is where
            everyone&rsquo;s circles meet.
          </p>
          {list ? (
            <Link href={`/search?list=${list.id}`} className={buttonClass("marquee", "mt-2")}>
              Add movies
            </Link>
          ) : null}
        </div>
      )}

      {group.created_by === claims.claims.sub ? (
        <>
          <GroupVisibilityPanel groupId={group.id} current={group.visibility} />
          <DeleteGroupPanel groupId={group.id} groupName={group.name} />
        </>
      ) : (
        <LeaveGroupPanel groupId={group.id} groupName={group.name} />
      )}
    </Screen>
  );
}
