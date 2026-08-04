import { NextResponse } from "next/server";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;

  if (typeof userId !== "string") {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // RLS is the security boundary here, not an ownership filter -- several of
  // these policies are deliberately widened to let a user READ other people's
  // rows (public/followers-visible lists, co-attendees on a shared night).
  // Without an explicit owner filter, "your data export" would ship other
  // users' list contents. Every query below filters to userId even where RLS
  // would already return only the caller's own rows, so this stays correct if
  // a future phase widens a policy again.
  const [
    { data: profile },
    { data: lists },
    { data: votes },
    { data: following },
    { data: followers },
    { data: blocks },
    { data: groupMembers },
    { data: inbox },
    { data: imports },
    { data: movieNights },
    { data: notificationPrefs },
    { data: hypeHistory },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, default_list_visibility, region, created_at")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("lists")
      .select("id, name, visibility, is_default, created_at, list_items(movie_id, note, added_at, movies(title, year, media_type))")
      .eq("owner_user_id", userId),
    supabase
      .from("user_movie_status")
      .select("movie_id, watched, watched_at, rating, hype, updated_at"),
    supabase.from("follows").select("followee_id, created_at").eq("follower_id", userId),
    supabase.from("follows").select("follower_id, created_at").eq("followee_id", userId),
    supabase.from("blocks").select("blocked_id, created_at"),
    // group_members_select_peers reads every member's row for a shared group
    // (needed to render group rosters elsewhere), not just the caller's own
    // membership -- same over-fetch class as profiles/lists above.
    supabase
      .from("group_members")
      .select("group_id, role, joined_at, groups(id, name)")
      .eq("user_id", userId),
    supabase
      .from("ingest_inbox")
      .select("id, raw_text, source, status, resolved_movie_id, created_at"),
    supabase.from("imports").select("id, source, total, matched, status, created_at"),
    supabase
      .from("movie_night_attendees")
      .select("movie_night_id, movie_nights(id, group_id, mode, held_at, picked_movie_id)")
      .eq("user_id", userId),
    supabase.from("notification_prefs").select("category, push, email"),
    supabase
      .from("hype_history")
      .select("movie_id, hype, recorded_at, resolved_rating")
      .eq("user_id", userId),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    format_version: 1,
    profile,
    lists: lists ?? [],
    votes: votes ?? [],
    following: following ?? [],
    followers: followers ?? [],
    blocks: blocks ?? [],
    groups: groupMembers ?? [],
    inbox: inbox ?? [],
    imports: imports ?? [],
    movie_nights: movieNights ?? [],
    notification_prefs: notificationPrefs ?? [],
    hype_history: hypeHistory ?? [],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="venn-export.json"',
    },
  });
}
