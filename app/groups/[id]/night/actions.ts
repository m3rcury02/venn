"use server";

import { revalidatePath } from "next/cache";
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
): Promise<LogNightResult> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  const { data, error } = await supabase.rpc("log_movie_night", {
    p_group_id: groupId,
    p_mode: mode,
    p_movie_id: movieId,
    p_present: present,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const { data: group } = await supabase
    .from("groups")
    .select("name")
    .eq("id", groupId)
    .maybeSingle();

  const groupName = group?.name || "your group";

  for (const attendeeId of present) {
    if (attendeeId !== me) {
      sendPush(attendeeId, "night_invite", {
        title: "Movie night invite",
        body: `You were invited to a movie night in ${groupName}`,
        url: `/groups/${groupId}/night`,
      });
    }
  }

  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/night`);

  return { ok: true, nightId: data as string };
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
