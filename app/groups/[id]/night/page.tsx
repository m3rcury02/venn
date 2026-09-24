import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { MovieCard } from "@/components/movie-card";
import { NightModePicker } from "@/components/night-mode-picker";
import { NightLobby, StartRemoteNight } from "@/components/night-lobby";
import { NightPickHero } from "@/components/night-pick-hero";
import { NoneOfThese } from "@/components/none-of-these-button";
import {
  parsePresent,
  PresentPicker,
  type Member,
  type NightMode,
} from "@/components/present-picker";
import { Ticker } from "@/components/ticker";
import { buttonClass } from "@/components/ui/button";
import { LinkPending } from "@/components/ui/link-pending";
import { Reveal } from "@/components/ui/reveal";
import { Screen } from "@/components/ui/screen";
import { VennMark } from "@/components/venn-mark";
import { explain, releaseLabel, type Recommendation } from "@/lib/recommend/explain";
import { widenCandidates } from "@/lib/recommend/widen";
import { theatreCandidates, type TheatreCandidate } from "@/lib/movies/theatre";
import { provider } from "@/lib/providers";
import { getClaims } from "@/lib/supabase/claims";
import { LogNightButton } from "@/components/log-night-button";
import { createClient } from "@/lib/supabase/server";
import { withinRateLimit } from "@/lib/rate-limit";
import { lobbyCutoff } from "@/lib/lobby";

// SPEC §7 screen 6. Home mode is phase 4; theatre mode is phase 9; logging is phase 11.
type MemberRow = {
  user_id: string;
  profiles: { display_name: string | null; region: string | null } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type NightPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ present?: string; exclude?: string; mode?: string; night?: string }>;
};

function nightHref(
  groupId: string,
  mode: NightMode,
  present: string[],
  memberIds: string[],
  exclude: string[],
  night?: string,
) {
  const params = new URLSearchParams();
  if (mode === "theatre") params.set("mode", mode);
  // In lobby mode, attendance is server-side (movie_night_attendees), not URL
  // state -- `present` is derived from it, so it would be misleading to also
  // reflect it back into the query string.
  if (night) {
    params.set("night", night);
  } else if (present.length !== memberIds.length) {
    params.set("present", present.join(","));
  }
  if (exclude.length > 0) params.set("exclude", exclude.join(","));
  const qs = params.toString();
  return `/groups/${groupId}/night${qs ? `?${qs}` : ""}`;
}

export default async function MovieNightPage({ params, searchParams }: NightPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

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
    .select("user_id, profiles(display_name, region)")
    .eq("group_id", id)
    .order("joined_at", { ascending: true });

  const memberRows = (rawMembers as unknown as MemberRow[] | null) ?? [];
  const members: Member[] = memberRows.map((m) => ({
    id: m.user_id,
    name: m.profiles?.display_name ?? "Member",
  }));
  const memberIds = members.map((m) => m.id);
  const regionByMember = new Map(memberRows.map((m) => [m.user_id, m.profiles?.region ?? null]));

  const {
    present: rawPresent,
    exclude: rawExclude,
    mode: rawMode,
    night: rawNight,
  } = await searchParams;
  // All come from the URL. `present` is intersected with real members, which
  // also satisfies recommend_movies' own guard; `exclude` only has to be
  // well-formed, since a stray id simply matches no candidate.
  const exclude = (rawExclude?.split(",") ?? []).filter((v) => UUID.test(v));
  const mode: NightMode = rawMode === "theatre" ? "theatre" : "home";

  // SPEC §4.5's remote-night lobby: `night` names an open movie_nights row
  // and, while it's open, attendance replaces `present` as the source of
  // truth for who's here. `.eq("group_id", id)` guards against a night from a
  // *different* group the caller also happens to belong to; movie_nights
  // itself is null for a non-member, same as the group read above, so both
  // cases 404 rather than leak.
  const requestedNightId = rawNight && UUID.test(rawNight) ? rawNight : undefined;
  let nightRow: { id: string; mode: string; closed_at: string | null; held_at: string } | null =
    null;
  if (requestedNightId) {
    const { data } = await supabase
      .from("movie_nights")
      .select("id, mode, closed_at, held_at")
      .eq("id", requestedNightId)
      .eq("group_id", id)
      .maybeSingle();
    if (!data) notFound();
    nightRow = data;
  }
  // A `night` param pointing at an already-closed night (a stale/reloaded
  // link) is treated as absent rather than re-entering lobby UI for a
  // finished pick. An expired lobby (lib/lobby.ts) is treated the same way:
  // its roster may be from a different evening, and join/close would refuse
  // it anyway.
  const cutoff = lobbyCutoff();
  const isLobby =
    nightRow !== null &&
    nightRow.closed_at === null &&
    new Date(nightRow.held_at).getTime() >= new Date(cutoff).getTime();

  let attendeeIds: string[] = [];
  if (isLobby) {
    const { data: rawAttendees } = await supabase
      .from("movie_night_attendees")
      .select("user_id")
      .eq("movie_night_id", nightRow!.id);
    attendeeIds = (rawAttendees ?? []).map((a) => a.user_id);
  }

  const present = isLobby
    ? attendeeIds.filter((uid) => memberIds.includes(uid))
    : parsePresent(rawPresent, memberIds);

  type OpenLobbyRow = { id: string; profiles: { display_name: string | null } | null };
  let openLobby: { id: string; starterName: string; attendeeCount: number } | null = null;
  if (!isLobby) {
    // movie_nights has three paths to profiles (created_by directly, plus
    // attendees and watch_confirmations junction tables) -- the FK has to be
    // named or PostgREST refuses the embed as ambiguous.
    const { data: rawOpen } = await supabase
      .from("movie_nights")
      .select("id, profiles!movie_nights_created_by_fkey(display_name)")
      .eq("group_id", id)
      .is("closed_at", null)
      // An expired lobby still sits here until the group opens a new one
      // (open_movie_night deletes it then), so it has to be filtered out,
      // not just assumed gone.
      .gte("held_at", cutoff)
      .maybeSingle();
    const openRow = rawOpen as unknown as OpenLobbyRow | null;
    if (openRow) {
      const { count } = await supabase
        .from("movie_night_attendees")
        .select("user_id", { count: "exact", head: true })
        .eq("movie_night_id", openRow.id);
      openLobby = {
        id: openRow.id,
        starterName: openRow.profiles?.display_name ?? "Someone",
        attendeeCount: count ?? 0,
      };
    }
  }

  // Theatre mode's region: if every present member shares one, use it
  // silently; otherwise fall back to the caller's own and say so, rather than
  // refusing to pick (decided this session).
  const presentRegions = present
    .map((memberId) => regionByMember.get(memberId))
    .filter((r): r is string => Boolean(r));
  const uniqueRegions = new Set(presentRegions);
  const callerRegion = regionByMember.get(userId) ?? "IN";
  const region = uniqueRegions.size === 1 ? [...uniqueRegions][0] : callerRegion;
  const regionMismatch = mode === "theatre" && uniqueRegions.size > 1;

  let picks: Recommendation[] = [];
  let releaseByMovie = new Map<string, TheatreCandidate>();
  let widenedIds = new Set<string>();

  if (present.length > 0) {
    if (mode === "theatre") {
      const candidates = await theatreCandidates(region);
      releaseByMovie = new Map(candidates.map((c) => [c.movieId, c]));
      // p_candidates is the function's home/theatre switch (null = home) --
      // this must always be a real array, even an empty one, or an empty
      // theatre pool would silently fall through to home-mode's group-list
      // candidates and render the wrong picks under the Theatre tab.
      const { data } = await supabase.rpc("recommend_movies", {
        p_group_id: id,
        p_present: present,
        p_exclude: exclude,
        p_candidates: candidates.map((c) => c.movieId),
      });
      picks = (data as unknown as Recommendation[] | null) ?? [];
    } else {
      // SPEC §4.2's widen step, home mode only. recommend_movies' own
      // group-list pool (p_candidates null) is exactly `poolIds` below, so
      // this read has to be unbounded to stay correct once p_candidates is
      // passed non-null: 1000 rows (supabase/config.toml's max_rows) is far
      // past anything a 4-6 person group's list will ever hold.
      const { data: rawPoolItems } = await supabase
        .from("list_items")
        .select("movie_id, lists!inner(owner_group_id)")
        .eq("lists.owner_group_id", id);
      const poolIds = [
        ...new Set(
          ((rawPoolItems as { movie_id: string }[] | null) ?? []).map((r) => r.movie_id),
        ),
      ];

      // Widening fetches TMDB recommendations and caches new titles on every
      // render, and this page re-renders on every pick/reroll. Past the
      // budget it degrades to the group's own list -- the same result
      // widenCandidates gives when TMDB is unreachable.
      const widened = (await withinRateLimit(supabase, "widen"))
        ? await widenCandidates(supabase, id, present, exclude, poolIds)
        : [];
      widenedIds = new Set(widened);

      const { data } = await supabase.rpc(
        "recommend_movies",
        widened.length > 0
          ? {
              p_group_id: id,
              p_present: present,
              p_exclude: exclude,
              p_candidates: [...poolIds, ...widened],
            }
          : { p_group_id: id, p_present: present, p_exclude: exclude },
      );
      picks = (data as unknown as Recommendation[] | null) ?? [];
    }
  }

  const [winner, ...runnersUp] = picks;

  function reasonsFor(pick: Recommendation) {
    if (mode !== "theatre") return explain(pick, undefined, widenedIds.has(pick.movie_id));
    const release = releaseByMovie.get(pick.movie_id);
    return explain(pick, release ? releaseLabel(release.releaseType, release.releaseDate) : undefined);
  }

  const lobbyNightId = isLobby ? nightRow!.id : undefined;

  const rerollHref = nightHref(
    id,
    mode,
    present,
    memberIds,
    [...exclude, ...picks.map((p) => p.movie_id)],
    lobbyNightId,
  );
  const homeHref = nightHref(id, "home", present, memberIds, [], lobbyNightId);
  const theatreHref = nightHref(id, "theatre", present, memberIds, [], lobbyNightId);
  const startOverHref = nightHref(id, mode, present, memberIds, [], lobbyNightId);

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
        mobileActions={
          <Link href={`/groups/${id}`} className={navLinkClass}>
            Back to group
          </Link>
        }
      />

      <Ticker items={presentNames} />

      <div className="flex flex-col gap-3">
        <NightModePicker mode={mode} homeHref={homeHref} theatreHref={theatreHref} />
        {regionMismatch ? (
          <p className="t-label text-fg-faint">
            Not everyone here shares a region — showing what&rsquo;s playing in {region}.
          </p>
        ) : null}
      </div>

      {isLobby ? (
        <NightLobby
          attendees={members.filter((m) => present.includes(m.id))}
          isAttendee={present.includes(userId)}
          nightId={lobbyNightId!}
        />
      ) : (
        <>
          <PresentPicker groupId={id} members={members} present={present} mode={mode} />
          <StartRemoteNight groupId={id} mode={mode} openLobby={openLobby} />
        </>
      )}

      {present.length === 0 ? (
        <Empty
          title="Nobody’s here yet"
          body="Pick who’s watching tonight and the overlap will do the rest."
        />
      ) : picks.length > 0 ? (
        <>
          {/* No wrapper animation here -- NightPickHero owns its own
              orchestrated reveal now (letterbox close, backdrop bloom,
              poster rise, title strike, reasons stagger). Wrapping it in
              another fade would just run two arrivals on top of each
              other. */}
          <div className="flex flex-col gap-4 items-start">
            <NightPickHero
              title={winner.title}
              year={winner.year}
              href={`/movies/${winner.movie_id}`}
              backdropUrl={
                winner.poster_path ? provider.getImageUrl(winner.poster_path, "w780") : null
              }
              posterUrl={
                winner.poster_path ? provider.getImageUrl(winner.poster_path, "w342") : null
              }
              reasons={reasonsFor(winner)}
            />
            <LogNightButton
              groupId={id}
              mode={mode}
              movieId={winner.movie_id}
              present={present}
              nightId={lobbyNightId}
            />
          </div>

          {runnersUp.length > 0 ? (
            <div className="flex flex-col gap-4">
              <h2 className="t-label text-fg-faint">If not that</h2>
              <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:max-w-md">
                {runnersUp.map((pick, i) => (
                  <Reveal key={pick.movie_id} trigger="mount" index={i + 1}>
                    <MovieCard
                      title={pick.title}
                      year={pick.year}
                      href={`/movies/${pick.movie_id}`}
                      posterUrl={
                        pick.poster_path
                          ? provider.getImageUrl(pick.poster_path, "w342")
                          : null
                      }
                      footer={
                        <ul className="flex flex-col gap-1">
                          {reasonsFor(pick).map((reason) => (
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
                  </Reveal>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {/* SPEC §4.5: "None of these" logs the shown picks as rejected,
                then re-runs the recommender against a longer exclude list --
                same route+params as the old plain reroll. */}
            <NoneOfThese
              groupId={id}
              mode={mode}
              movieIds={picks.map((p) => p.movie_id)}
              rerollHref={rerollHref}
            />
            {exclude.length > 0 ? (
              <Link href={startOverHref} className={navLinkClass}>
                Start over
                <LinkPending size={14} />
              </Link>
            ) : null}
          </div>
        </>
      ) : (
        <Empty
          title={
            exclude.length > 0
              ? "That’s everything"
              : mode === "theatre"
                ? "Nothing in cinemas near you yet"
                : "Nothing to pick from"
          }
          body={
            exclude.length > 0
              ? mode === "theatre"
                ? "You’ve rerolled past everything showing. Start over, or check back later."
                : "You’ve rerolled past every candidate. Start over, or add more to the group list."
              : mode === "theatre"
                ? "Nothing in theatres or coming up in your region matched what this group hasn’t seen. Check back closer to a release."
                : "Everything on the group list has been seen by someone here. Add a few more and try again."
          }
          action={
            exclude.length > 0 ? (
              <Link href={startOverHref} className={buttonClass("marquee", "mt-2")}>
                Start over
              </Link>
            ) : mode === "home" ? (
              <Link href={`/groups/${id}`} className={buttonClass("marquee", "mt-2")}>
                Back to the list
              </Link>
            ) : undefined
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
