import { NextResponse } from "next/server";
import { resolvePrefs } from "@/lib/notifications/categories";
import { sendEmail } from "@/lib/notifications/email";
import { createServiceClient } from "@/lib/supabase/service";

export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const isSunday = new Date().getUTCDay() === 0;

  if (!isSunday && !force) {
    return NextResponse.json({ skipped: "not sunday" }, { status: 200 });
  }

  const service = createServiceClient();
  const host = request.headers.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  // Fetch all users from auth admin API
  const { data: authData, error: authError } = await service.auth.admin.listUsers();
  if (authError || !authData?.users) {
    return NextResponse.json({ error: "Could not list users." }, { status: 500 });
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let sentCount = 0;

  for (const user of authData.users) {
    if (!user.email || !user.email_confirmed_at) continue;

    // Check notification preferences for recipient
    const { data: prefRows } = await service
      .from("notification_prefs")
      .select("category, push, email")
      .eq("user_id", user.id);

    const prefs = resolvePrefs(prefRows as unknown as Parameters<typeof resolvePrefs>[0]);
    if (!prefs.weekly_digest.email) continue;

    // Gather friend additions if friend_added.email is true
    let friendAdditions: { title: string; addedBy: string }[] = [];
    if (prefs.friend_added.email) {
      const { data: followRows } = await service
        .from("follows")
        .select("followee_id, profiles!follows_followee_id_fkey(display_name, username)")
        .eq("follower_id", user.id);

      if (followRows && followRows.length > 0) {
        const followeeIds = followRows.map((f) => f.followee_id);
        const { data: rawItems } = await service
          .from("list_items")
          .select("added_by, movies(title), lists!inner(visibility)")
          .in("added_by", followeeIds)
          .eq("lists.visibility", "public")
          .gte("added_at", sevenDaysAgo)
          .limit(10);

        if (rawItems) {
          friendAdditions = rawItems
            .filter((item) => (item.movies as unknown as { title: string })?.title)
            .map((item) => {
              const followee = followRows.find((f) => f.followee_id === item.added_by);
              const name = (followee?.profiles as unknown as { display_name: string | null; username: string | null })?.display_name || "A friend";
              return {
                title: (item.movies as unknown as { title: string }).title,
                addedBy: name,
              };
            });
        }
      }
    }

    // Gather logged movie nights for groups recipient belongs to
    const { data: memberRows } = await service
      .from("group_members")
      .select("group_id")
      .eq("user_id", user.id);

    let loggedNights: { movieTitle: string; groupName: string }[] = [];
    if (memberRows && memberRows.length > 0) {
      const groupIds = memberRows.map((m) => m.group_id);
      const { data: rawNights } = await service
        .from("movie_nights")
        .select("picked_movie_id, movies(title), groups(name)")
        .in("group_id", groupIds)
        .gte("held_at", sevenDaysAgo)
        .limit(10);

      if (rawNights) {
        loggedNights = rawNights
          .filter((n) => (n.movies as unknown as { title: string })?.title && (n.groups as unknown as { name: string })?.name)
          .map((n) => ({
            movieTitle: (n.movies as unknown as { title: string }).title,
            groupName: (n.groups as unknown as { name: string }).name,
          }));
      }
    }

    if (friendAdditions.length === 0 && loggedNights.length === 0) {
      continue;
    }

    const html = `
      <div style="font-family: system-ui, sans-serif; background-color: #0b0b0c; color: #f0f0f2; padding: 32px; max-width: 600px; margin: 0 auto; border-radius: 8px;">
        <h1 style="font-size: 24px; font-weight: bold; margin-bottom: 16px; color: #ffffff;">Your Weekly Venn Digest</h1>
        
        ${
          friendAdditions.length > 0
            ? `<div style="margin-bottom: 24px;">
                <h2 style="font-size: 16px; color: #9a9a9c; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">Friend Additions</h2>
                <ul style="padding-left: 20px; color: #d0d0d5;">
                  ${friendAdditions.map((item) => `<li style="margin-bottom: 6px;"><strong>${item.addedBy}</strong> added <strong>${item.title}</strong></li>`).join("")}
                </ul>
              </div>`
            : ""
        }

        ${
          loggedNights.length > 0
            ? `<div style="margin-bottom: 24px;">
                <h2 style="font-size: 16px; color: #9a9a9c; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">Group Movie Nights</h2>
                <ul style="padding-left: 20px; color: #d0d0d5;">
                  ${loggedNights.map((night) => `<li style="margin-bottom: 6px;"><strong>${night.groupName}</strong> logged <strong>${night.movieTitle}</strong></li>`).join("")}
                </ul>
              </div>`
            : ""
        }

        <div style="border-top: 1px solid #202024; padding-top: 16px; margin-top: 32px; font-size: 12px; color: #6e6e73;">
          <p>You are receiving this digest because email notifications are enabled for your account.</p>
          <p><a href="${baseUrl}/settings/notifications" style="color: #4a9eff; text-decoration: underline;">Manage notification preferences</a></p>
        </div>
      </div>
    `;

    const sent = await sendEmail({
      to: user.email,
      subject: "Your Weekly Venn Digest",
      html,
    });

    if (sent) sentCount++;
  }

  return NextResponse.json({ ok: true, sentCount });
}
