"use server";

import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type UserSearchResult = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export async function searchUsers(query: string): Promise<UserSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  // Escape special ilike pattern characters if needed, or query cleanly
  const safeQuery = trimmed.replace(/[%_]/g, "\\$&");
  const { data: users } = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url")
    .or(`username.ilike.%${safeQuery}%,display_name.ilike.%${safeQuery}%`)
    .limit(20);

  if (!users) return [];

  return users.filter((user) => user.id !== me);
}
