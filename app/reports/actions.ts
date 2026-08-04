"use server";

import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";

export type TargetType = "user" | "list" | "list_item";
export type ReportActionResult = { ok: boolean; error?: string };

export async function submitReport(
  targetType: TargetType,
  targetId: string,
  reason: string,
): Promise<ReportActionResult> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const me = claims?.claims?.sub;

  if (typeof me !== "string") {
    return { ok: false, error: "Not signed in." };
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason || trimmedReason.length > 1000) {
    return { ok: false, error: "Reason must be between 1 and 1000 characters." };
  }

  if (!["user", "list", "list_item"].includes(targetType)) {
    return { ok: false, error: "Invalid target type." };
  }

  const { error } = await supabase.from("reports").insert({
    reporter_id: me,
    target_type: targetType,
    target_id: targetId,
    reason: trimmedReason,
  });

  if (error) {
    // 23505: unique constraint violation (user already reported this target).
    // Duplicate report is treated as success per repo conventions.
    if (error.code === "23505") {
      return { ok: true };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
