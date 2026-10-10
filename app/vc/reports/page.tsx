import Link from "next/link";
import { EmptyState } from "@/components/vc/EmptyState";
import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { formatDateTime } from "@/lib/vc/format";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

export default async function ReportsPage() {
  const ctx = await requirePageContext("/vc/reports");
  if (!ctx.activeOrg) return <NoWorkspace />;
  const reports = await getVcServices().reports.list(ctx, { limit: 100 });
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Saved reports</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Frozen snapshots of study reports. Generate a live report from any study page.
        </p>
      </header>
      {reports.length === 0 ? (
        <EmptyState title="No saved reports" action={{ href: "/vc/studies", label: "Browse studies" }}>
          Open a study, choose Report, then Save snapshot.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <Link href={`/vc/reports/${r.id}`} className="font-medium hover:underline">
                {r.title}
              </Link>
              <span className="text-xs text-slate-500">Data as of {formatDateTime(r.generatedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
