import webPush from "web-push";
import { resolvePrefs, type NotificationCategory } from "@/lib/notifications/categories";
import { createServiceClient } from "@/lib/supabase/service";

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
};

export async function sendPush(
  userId: string,
  category: NotificationCategory,
  payload: PushPayload,
): Promise<void> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:support@example.com";

  if (!publicKey || !privateKey) return;

  try {
    const service = createServiceClient();

    // Read user's preferences overlay onto defaults
    const { data: prefRows } = await service
      .from("notification_prefs")
      .select("category, push, email")
      .eq("user_id", userId);

    const resolved = resolvePrefs(prefRows as unknown as Parameters<typeof resolvePrefs>[0]);
    if (!resolved[category]?.push) return;

    // Read user's push subscriptions
    const { data: subscriptions } = await service
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);

    if (!subscriptions || subscriptions.length === 0) return;

    webPush.setVapidDetails(subject, publicKey, privateKey);
    const payloadString = JSON.stringify(payload);

    for (const sub of subscriptions) {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          payloadString,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or invalid: prune subscription row
          await service
            .from("push_subscriptions")
            .delete()
            .eq("id", sub.id);
        }
      }
    }
  } catch {
    // Push delivery failure must never break caller operations
  }
}
