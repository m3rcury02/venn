"use server";

import { revalidatePath } from "next/cache";
import { captureServer } from "@/lib/analytics/server";
import { sendPush } from "@/lib/notifications/send";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type LogNightResult = {
  ok: boolean;
  nightId?: string;
  error?: string;
};

export async function logNight(
  groupId: string,
  mode: "home" | "theatre",
  movieId: string,
  present: string[],
  nightId?: string,
): Promise<LogNightResult> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  // A remote night's row already exists (opened via startRemoteNight) --
  // close it rather than inserting a second one, or the digest and §10's
  // stats would silently double-count the evening.
  let data: string | null;
  let error: { message: string; code?: string } | null;
  if (nightId) {
    ({ error } = await supabase.rpc("close_movie_night", {
      p_night_id: nightId,
      p_movie_id: movieId,
      p_mode: mode,
    }));
    data = error ? null : nightId;
  } else {
    ({ data, error } = await supabase.rpc("log_movie_night", {
      p_group_id: groupId,
      p_mode: mode,
      p_movie_id: movieId,
      p_present: present,
    }));
  }

  if (error) {
    // P0429: log_movie_night's per-user budget (public-launch hardening).
    return {
      ok: false,
      error:
        error.code === "P0429"
          ? "You've logged a lot of nights this hour. Try again later."
          : error.message,
    };
  }

  // Who to notify comes from the attendee rows Postgres wrote, not from
  // `present`. `present` is whatever the client sent: log_movie_night already
  // drops anyone who isn't a member, but the push loop below used to trust
  // the raw array, so any signed-in user could push a "movie night invite"
  // to any user id. movie_night_attendees_select_member lets a member read
  // these rows.
  const { data: attendeeRows } = data
    ? await supabase
        .from("movie_night_attendees")
        .select("user_id")
        .eq("movie_night_id", data)
    : { data: [] as { user_id: string }[] };
  const attendees = (attendeeRows ?? []).map((row) => row.user_id as string);

  // The event the whole product hinges on: a group actually settled on a
  // film. Weekly unique group_ids on this event are "groups that come back",
  // which is the number that decides whether Venn is ready for more users.
  await captureServer(me, "night_logged", {
    group_id: groupId,
    mode,
    remote: Boolean(nightId),
    attendees: attendees.length,
  });

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", groupId)
    .maybeSingle();

  const groupName = group?.name || "your group";

  // Awaited together: an un-awaited sendPush can be dropped mid-flight when a
  // serverless function's response returns before the underlying fetches
  // complete. sendPush never throws, so this cannot fail the caller.
  await Promise.all(
    attendees
      .filter((attendeeId) => attendeeId !== me)
      .map((attendeeId) =>
        sendPush(attendeeId, "night_invite", {
          title: "Movie night invite",
          body: `You were invited to a movie night in ${groupName}`,
          url: `/groups/${groupId}/night`,
        }),
      ),
  );

  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/night`);

  return { ok: true, nightId: data ?? undefined };
}

// SPEC §4.5: "Remote nights: a lobby with a join link." Starts a lobby for
// this group, or hands back the id of the one already open -- two members
// tapping this within a second of each other is normal, not an error.
export async function startRemoteNight(
  groupId: string,
  mode: "home" | "theatre",
): Promise<{ ok: boolean; nightId?: string; error?: string }> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  const { data, error } = await supabase.rpc("open_movie_night", {
    p_group_id: groupId,
    p_mode: mode,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, nightId: data ?? undefined };
}

// Joining is always an explicit tap (see components/night-lobby.tsx), never
// automatic on page load -- attendance here is what §8's watch confirmations
// fire against.
export async function joinRemoteNight(nightId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  const { error } = await supabase.rpc("join_movie_night", { p_night_id: nightId });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}

// SPEC §4.5: "None of these -- log it, useful signal." Best-effort and never
// throws -- analytics must not break the reroll, the same reflex as
// widenCandidates returning [] on provider failure rather than 500ing the
// picker. No redirect() here: the caller navigates client-side (see
// components/none-of-these-button.tsx for why).
export async function noneOfThese(
  groupId: string,
  mode: "home" | "theatre",
  movieIds: string[],
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false };
  }

  // §4.3 only ever returns top 3; cap defensively since this is a public
  // authenticated endpoint and RLS doesn't bound array length.
  const { error } = await supabase.from("night_rejections").insert(
    movieIds.slice(0, 3).map((movieId) => ({
      group_id: groupId,
      user_id: me,
      movie_id: movieId,
      mode,
    })),
  );

  // night_rejections holds the detail; this is only the count PostHog needs
  // to put rejections next to night_logged. captureServer never throws, so
  // the reroll still can't be broken by analytics.
  if (!error) {
    await captureServer(me, "picks_rejected", { group_id: groupId, mode });
  }

  return { ok: !error };
}

export async function respondWatchConfirmation(
  nightId: string,
  status: "confirmed" | "declined",
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  const { error } = await supabase
    .from("watch_confirmations")
    .update({ status })
    .eq("movie_night_id", nightId)
    .eq("user_id", me);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  return { ok: true };
}
