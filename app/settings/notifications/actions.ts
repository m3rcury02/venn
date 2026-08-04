"use server";

import { revalidatePath } from "next/cache";
import type { NotificationCategory } from "@/lib/notifications/categories";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export async function setNotificationPref(
  category: NotificationCategory,
  push: boolean,
  email: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;

  if (typeof userId !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  const { error } = await supabase.from("notification_prefs").upsert({
    user_id: userId,
    category,
    push,
    email,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/settings/notifications");
  return { ok: true };
}
