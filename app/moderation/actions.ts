"use server";

import { revalidatePath } from "next/cache";
import { isAdminUser } from "@/lib/moderation/admin";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type ModerationActionResult = { ok: boolean; error?: string };

async function verifyAdmin(): Promise<string | null> {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string" || !isAdminUser(userId)) {
    return null;
  }
  return userId;
}

export async function dismissReport(reportId: string): Promise<ModerationActionResult> {
  const adminId = await verifyAdmin();
  if (!adminId) {
    return { ok: false, error: "Not authorized." };
  }

  const service = createServiceClient();
  const { error } = await service
    .from("reports")
    .update({ status: "dismissed" })
    .eq("id", reportId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/moderation");
  return { ok: true };
}

export async function deleteReportedContent(reportId: string): Promise<ModerationActionResult> {
  const adminId = await verifyAdmin();
  if (!adminId) {
    return { ok: false, error: "Not authorized." };
  }

  const service = createServiceClient();
  const { data: report, error: reportError } = await service
    .from("reports")
    .select("id, target_type, target_id, target_movie_id")
    .eq("id", reportId)
    .single();

  if (reportError || !report) {
    return { ok: false, error: "Report not found." };
  }

  if (report.target_type === "list_item") {
    // list_items' primary key is (list_id, movie_id) -- scoping the delete by
    // list_id alone would remove every item in the list, not just the
    // reported note. target_movie_id is the migration's added half of the key
    // and is guaranteed non-null for 'list_item' reports by a check
    // constraint, but this action refuses to run without it regardless.
    if (!report.target_movie_id) {
      return { ok: false, error: "This report is missing its movie reference." };
    }

    const { error: deleteError } = await service
      .from("list_items")
      .delete()
      .eq("list_id", report.target_id)
      .eq("movie_id", report.target_movie_id);

    if (deleteError) return { ok: false, error: deleteError.message };
  } else if (report.target_type === "list") {
    const { error: updateError } = await service
      .from("lists")
      .update({ name: "Removed" })
      .eq("id", report.target_id);

    if (updateError) return { ok: false, error: updateError.message };
  } else if (report.target_type === "user") {
    const { error: updateError } = await service
      .from("profiles")
      .update({ display_name: "Removed" })
      .eq("id", report.target_id);

    if (updateError) return { ok: false, error: updateError.message };
  }

  const { error: actionError } = await service
    .from("reports")
    .update({ status: "actioned" })
    .eq("id", reportId);

  if (actionError) return { ok: false, error: actionError.message };

  revalidatePath("/moderation");
  return { ok: true };
}

export async function deleteReportedAccount(reportId: string): Promise<ModerationActionResult> {
  const adminId = await verifyAdmin();
  if (!adminId) {
    return { ok: false, error: "Not authorized." };
  }

  const service = createServiceClient();
  const { data: report, error: reportError } = await service
    .from("reports")
    .select("id, target_type, target_id")
    .eq("id", reportId)
    .single();

  if (reportError || !report) {
    return { ok: false, error: "Report not found." };
  }

  if (report.target_type !== "user") {
    return { ok: false, error: "Report target is not a user." };
  }

  const { error: deleteAuthError } = await service.auth.admin.deleteUser(report.target_id);
  if (deleteAuthError) {
    return { ok: false, error: deleteAuthError.message };
  }

  await service.from("reports").update({ status: "actioned" }).eq("id", reportId);

  revalidatePath("/moderation");
  return { ok: true };
}
