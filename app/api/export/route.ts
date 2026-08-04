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

  // Use user-scoped client. RLS automatically scopes all results to the caller.
  const [
    { data: profile },
    { data: lists },
    { data: votes },
    { data: follows },
    { data: blocks },
    { data: groupMembers },
    { data: inbox },
    { data: imports },
    { data: movieNights },
    { data: notificationPrefs },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, default_list_visibility, region, created_at")
      .maybeSingle(),
    supabase
      .from("lists")
      .select("id, name, visibility, is_default, created_at, list_items(movie_id, note, added_at, movies(title, year, media_type))"),
    supabase
      .from("user_movie_status")
      .select("movie_id, watched, watched_at, rating, hype, updated_at"),
    supabase.from("follows").select("followee_id, created_at"),
    supabase.from("blocks").select("blocked_id, created_at"),
    supabase.from("group_members").select("group_id, role, joined_at, groups(id, name)"),
    supabase
      .from("ingest_inbox")
      .select("id, raw_text, source, status, resolved_movie_id, created_at"),
    supabase.from("imports").select("id, source, total, matched, status, created_at"),
    supabase
      .from("movie_night_attendees")
      .select("movie_night_id, movie_nights(id, group_id, mode, held_at, picked_movie_id)"),
    supabase.from("notification_prefs").select("category, push, email"),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    format_version: 1,
    profile,
    lists: lists ?? [],
    votes: votes ?? [],
    follows: follows ?? [],
    blocks: blocks ?? [],
    groups: groupMembers ?? [],
    inbox: inbox ?? [],
    imports: imports ?? [],
    movie_nights: movieNights ?? [],
    notification_prefs: notificationPrefs ?? [],
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="venn-export.json"',
    },
  });
}
