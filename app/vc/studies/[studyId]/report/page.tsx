import Link from "next/link";
import { ReportActions } from "@/components/vc/ReportActions";
import { ReportView } from "@/components/vc/ReportView";
import { VcError } from "@/lib/vc/errors";
import { getVcServices } from "@/lib/vc/server/container";
import { orNotFound, requirePageContext } from "@/lib/vc/server/page";

export default async function StudyReportPage({ params }: { params: Promise<{ studyId: string }> }) {
  const { studyId } = await params;
  const ctx = await requirePageContext(`/vc/studies/${studyId}/report`);
  let report;
  try {
    report = await orNotFound(getVcServices().reports.generate(ctx, studyId));
  } catch (err) {
    if (err instanceof VcError && err.code === "FORBIDDEN") {
      return (
        <p className="rounded-lg border border-slate-200 bg-white p-6 text-sm dark:border-slate-800 dark:bg-slate-950">
          Reports are available to the firm that owns this study.{" "}
          <Link href={`/vc/studies/${studyId}`} className="underline">
            Back to study
          </Link>
        </p>
      );
    }
    throw err;
  }
  const membership = ctx.memberships.find((m) => m.organizationId === report.organization.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={`/vc/studies/${studyId}`} className="text-sm underline">
          ← Back to study
        </Link>
        <ReportActions
          exportBase={`/api/studies/${studyId}/report`}
          studyId={studyId}
          canSave={!!membership && membership.role !== "VIEWER"}
        />
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-950 print:border-0 print:p-0">
        <ReportView report={report} />
      </div>
    </div>
  );
}
