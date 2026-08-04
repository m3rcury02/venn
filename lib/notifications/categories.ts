export type NotificationCategory =
  | "watch_confirmation"
  | "night_invite"
  | "new_follower"
  | "friend_added"
  | "weekly_digest";

export type CategoryMeta = {
  label: string;
  push: boolean;
  email: boolean;
};

export const CATEGORIES: Record<NotificationCategory, CategoryMeta> = {
  watch_confirmation: { label: "Watch confirmation request", push: true,  email: false },
  night_invite:       { label: "Movie night invite",         push: true,  email: false },
  new_follower:       { label: "New follower",               push: true,  email: false },
  // SPEC §8: "digest only" -- the weekly digest is this category's delivery
  // channel, so its email default is on. Push stays off deliberately (§8:
  // "fine at 5 follows and unusable at 200. Do not default it to push.").
  friend_added:       { label: "Friend added a movie",       push: false, email: true  },
  weekly_digest:      { label: "Weekly digest",              push: false, email: true  },
} as const;

export type NotificationPrefRow = {
  category: NotificationCategory;
  push: boolean;
  email: boolean;
};

export function resolvePrefs(
  rows: NotificationPrefRow[] | null | undefined,
): Record<NotificationCategory, CategoryMeta> {
  const result: Record<NotificationCategory, CategoryMeta> = {
    watch_confirmation: { ...CATEGORIES.watch_confirmation },
    night_invite:       { ...CATEGORIES.night_invite },
    new_follower:       { ...CATEGORIES.new_follower },
    friend_added:       { ...CATEGORIES.friend_added },
    weekly_digest:      { ...CATEGORIES.weekly_digest },
  };

  if (!rows) return result;

  for (const row of rows) {
    if (row.category in result) {
      result[row.category as NotificationCategory] = {
        label: CATEGORIES[row.category as NotificationCategory].label,
        push: row.push,
        email: row.email,
      };
    }
  }

  return result;
}
