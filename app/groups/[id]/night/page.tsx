import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { MovieCard } from "@/components/movie-card";
import { NightPickHero } from "@/components/night-pick-hero";
import { parsePresent, PresentPicker, type Member } from "@/components/present-picker";
import { Ticker } from "@/components/ticker";
import { buttonClass } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
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
  const [winner, ...runnersUp] = picks;

  const rerollHref = nightHref(id, present, memberIds, [
    ...exclude,
    ...picks.map((p) => p.movie_id),
  ]);

  // The marquee runs whoever is actually here -- names the page already has,
  // so this costs no extra query.
  const presentNames = members.filter((m) => present.includes(m.id)).map((m) => m.name);

  return (
    <Screen>
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

      <Ticker items={presentNames} />

      <PresentPicker groupId={id} members={members} present={present} />

      {present.length === 0 ? (
        <Empty
          title="Nobody’s here yet"
          body="Pick who’s watching tonight and the overlap will do the rest."
        />
      ) : picks.length > 0 ? (
        <>
          <div className="motion-safe:animate-expose">
            <NightPickHero
              title={winner.title}
              year={winner.year}
              backdropUrl={
                winner.poster_path ? provider.getImageUrl(winner.poster_path, "w780") : null
              }
              posterUrl={
                winner.poster_path ? provider.getImageUrl(winner.poster_path, "w342") : null
              }
              reasons={explain(winner)}
            />
          </div>

          {runnersUp.length > 0 ? (
            <div className="flex flex-col gap-4">
              <h2 className="t-label text-fg-faint">If not that</h2>
              <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:max-w-md">
                {runnersUp.map((pick, i) => (
                  <div
                    key={pick.movie_id}
                    className="motion-safe:animate-expose"
                    style={{ animationDelay: `${(i + 1) * 70}ms` }}
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
                            <li key={reason} className="t-body text-[13px] text-fg-dim">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      }
                    >
                      <span className="t-data flex h-6 w-6 items-center justify-center rounded-ctl border border-hairline bg-ink/70 text-[11px] text-fg-dim backdrop-blur-sm">
                        {i + 2}
                      </span>
                    </MovieCard>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Link href={rerollHref} className={buttonClass("marquee")}>
              Reroll
            </Link>
            {exclude.length > 0 ? (
              <Link href={nightHref(id, present, memberIds, [])} className={navLinkClass}>
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
                className={buttonClass("marquee", "mt-2")}
              >
                Start over
              </Link>
            ) : (
              <Link href={`/groups/${id}`} className={buttonClass("marquee", "mt-2")}>
                Back to the list
              </Link>
            )
          }
        />
      )}
    </Screen>
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
    <div className="flex flex-1 flex-col items-center justify-center gap-5 py-20 text-center">
      <VennMark size={44} />
      <div className="space-y-3">
        <p className="t-section text-3xl text-fg">{title}</p>
        <p className="t-body mx-auto max-w-sm text-[15px] text-fg-dim">{body}</p>
      </div>
      {action}
    </div>
  );
}
