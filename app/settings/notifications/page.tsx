import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader, navLinkClass } from "@/components/app-header";
import { NotificationPrefRow } from "@/components/notification-pref-row";
import { PushToggle } from "@/components/push-toggle";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import {
  CATEGORIES,
  resolvePrefs,
  type NotificationCategory,
} from "@/lib/notifications/categories";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Notification Preferences — Venn",
  description: "Configure push and email notification preferences.",
};

export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;

  if (typeof userId !== "string") {
    redirect("/login");
  }

  const { data: rows } = await supabase
    .from("notification_prefs")
    .select("category, push, email")
    .eq("user_id", userId);

  const prefs = resolvePrefs(rows as unknown as Parameters<typeof resolvePrefs>[0]);
  const categoriesList = Object.keys(CATEGORIES) as NotificationCategory[];

  return (
    <Screen width="narrow">
      <AppHeader
        subtitle="Notification preferences"
        actions={
          <Link href="/settings" className={navLinkClass}>
            Settings
          </Link>
        }
      />

      <div className="flex flex-col gap-6">
        <Panel className="flex flex-col gap-3">
          <h1 className="t-section text-fg">Push Notifications</h1>
          <p className="t-body text-xs text-fg-dim">
            Enable or disable Web Push delivery on this browser device.
          </p>
          <PushToggle />
        </Panel>

        <Panel>
          <h2 className="t-section text-fg border-b border-hairline pb-3">Notification Matrix</h2>
          <div className="flex flex-col gap-2 mt-2">
            {categoriesList.map((cat) => {
              const meta = prefs[cat];
              const isFriendAdded = cat === "friend_added";
              return (
                <NotificationPrefRow
                  key={cat}
                  category={cat}
                  label={meta.label}
                  initialPush={meta.push}
                  initialEmail={meta.email}
                  pushDisabled={isFriendAdded}
                  pushDisabledCaption={
                    isFriendAdded
                      ? "Push is disabled for 'Friend added a movie' to prevent notification fatigue. Delivered via weekly digest."
                      : undefined
                  }
                />
              );
            })}
          </div>
        </Panel>
      </div>
    </Screen>
  );
}
