import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ModerationItemActions } from "@/components/moderation-item-actions";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/ui/screen";
import { isAdminUser } from "@/lib/moderation/admin";
import { getClaims } from "@/lib/supabase/claims";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = {
  title: "Moderation Queue — Venn",
  description: "Admin moderation reports queue.",
};

type ReportRow = {
  id: string;
  reporter_id: string;
  target_type: "user" | "list" | "list_item";
  target_id: string;
  reason: string;
  status: "open" | "actioned" | "dismissed";
  created_at: string;
  profiles: { username: string | null; display_name: string | null } | null;
};

export default async function ModerationPage() {
  const supabase = await createClient();
  const { data: claims } = await getClaims(supabase);
  const userId = claims?.claims?.sub;

  if (typeof userId !== "string" || !isAdminUser(userId)) {
    notFound();
  }

  const service = createServiceClient();
  const { data: rawReports, error } = await service
    .from("reports")
    .select("id, reporter_id, target_type, target_id, reason, status, created_at, profiles!reports_reporter_id_fkey(username, display_name)")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const reports = (rawReports ?? []) as unknown as ReportRow[];

  return (
    <Screen width="narrow">
      <AppHeader subtitle="Admin Moderation Queue" />
      <div className="flex flex-col gap-6">
        <Panel>
          <h1 className="t-section text-fg">Open Reports</h1>
          <p className="t-label mt-1 text-fg-faint">
            {reports.length} report{reports.length === 1 ? "" : "s"} pending action
          </p>
        </Panel>

        {reports.length === 0 ? (
          <Panel>
            <p className="t-body text-fg-dim">No open reports in the queue.</p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            {reports.map((report) => {
              const reporterName =
                report.profiles?.display_name ||
                report.profiles?.username ||
                report.reporter_id;
              return (
                <Panel key={report.id} className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline pb-2">
                    <span className="t-label text-xs text-fg-faint">
                      Target: <strong className="text-fg">{report.target_type}</strong> ({report.target_id})
                    </span>
                    <span className="t-label text-xs text-fg-faint">
                      {new Date(report.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  <p className="t-body text-sm text-fg-dim">
                    <strong className="text-fg">Reason:</strong> {report.reason}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
                    <span className="t-label text-xs text-fg-faint">
                      Reported by: {reporterName}
                    </span>
                    <ModerationItemActions
                      reportId={report.id}
                      targetType={report.target_type}
                    />
                  </div>
                </Panel>
              );
            })}
          </div>
        )}
      </div>
    </Screen>
  );
}
