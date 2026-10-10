import Link from "next/link";
import { ReportActions } from "@/components/vc/ReportActions";
import { ReportView } from "@/components/vc/ReportView";
import { formatDateTime } from "@/lib/vc/format";
import { getVcServices } from "@/lib/vc/server/container";
import { orNotFound, requirePageContext } from "@/lib/vc/server/page";

export default async function SavedReportPage({ params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const ctx = await requirePageContext(`/vc/reports/${reportId}`);
  const report = await orNotFound(getVcServices().reports.get(ctx, reportId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/vc/reports" className="text-sm underline">
          ← All reports
        </Link>
        <ReportActions exportBase={`/api/vc/reports/${report.id}`} canSave={false} />
      </div>
      <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        Snapshot saved {formatDateTime(report.createdAt)}. Figures reflect data at that time; see the{" "}
        <Link href={`/vc/studies/${report.studyId}`} className="underline">
          live study
        </Link>{" "}
        for current estimates.
      </p>
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-950 print:border-0 print:p-0">
        <ReportView report={report.content} />
      </div>
    </div>
  );
}
