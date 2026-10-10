import Link from "next/link";
import { EmptyState } from "@/components/vc/EmptyState";
import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { Section } from "@/components/vc/Section";
import { StatusBadge } from "@/components/vc/StatusBadge";
import { StudyTable } from "@/components/vc/StudyTable";
import { ALLOCATION_SHARE_EXPLAINER } from "@/lib/vc/constants";
import { formatPointChange, formatShare } from "@/lib/vc/estimates";
import { STATUS_LABELS, formatDate, formatDateTime, formatRelative } from "@/lib/vc/format";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";
import type { StudyStatus } from "@/lib/vc/types";

const COUNT_ORDER: StudyStatus[] = ["OPEN", "SUBMITTED", "APPROVED", "DRAFT", "CLOSED", "RESOLVED"];

export default async function VcDashboardPage() {
  const ctx = await requirePageContext("/vc");
  if (!ctx.activeOrg) return <NoWorkspace />;
  const d = await getVcServices().dashboard.get(ctx);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{d.organization.name}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Data as of {formatDateTime(d.generatedAt)}</p>
        </div>
        <Link
          href="/vc/studies/new"
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
        >
          Propose a study
        </Link>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {COUNT_ORDER.map((s) => (
          <div key={s} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950">
            <dt className="text-xs text-slate-500 dark:text-slate-400">{STATUS_LABELS[s]}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{d.statusCounts[s] ?? 0}</dd>
          </div>
        ))}
      </dl>

      <Section
        id="active"
        title="Active studies"
        description={`Open for forecasting. ${ALLOCATION_SHARE_EXPLAINER}`}
        actions={<Link href="/vc/studies" className="text-sm underline">All studies</Link>}
      >
        {d.activeStudies.length === 0 ? (
          <EmptyState title="No open studies" action={{ href: "/vc/studies/new", label: "Propose a study" }}>
            Studies open for forecasting after platform review.
          </EmptyState>
        ) : (
          <StudyTable
            showChange
            rows={d.activeStudies.map((r) => ({
              study: r.study,
              estimate: r.estimate,
              startupName: r.startupName,
              baselineValue: r.baseline.value,
              change7d: r.change7d,
            }))}
          />
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section
          id="movements"
          title="Meaningful movements (7 days)"
          description="Changes in YES allocation share of 5+ points with at least 3 participants."
        >
          {d.movements.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No significant movements this week.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.movements.map((r) => (
                <li key={r.study.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <Link href={`/vc/studies/${r.study.id}`} className="hover:underline">
                    {r.study.question}
                  </Link>
                  <span className="whitespace-nowrap text-right tabular-nums">
                    <span className="font-semibold">{formatPointChange(r.change7d)}</span>
                    <span className="block text-xs text-slate-500">now {formatShare(r.estimate?.allocation.yesShare)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="deadlines" title="Upcoming deadlines (14 days)">
          {d.upcomingDeadlines.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No deadlines in the next two weeks.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.upcomingDeadlines.map((r) => (
                <li key={r.study.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <Link href={`/vc/studies/${r.study.id}`} className="hover:underline">
                    {r.study.question}
                  </Link>
                  <span className="whitespace-nowrap text-right text-xs text-slate-500">
                    {formatDate(r.study.deadline)}
                    <span className="block">{formatRelative(r.study.deadline, d.generatedAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="pipeline" title="Pipeline" description="Drafts and studies awaiting review.">
          {d.pipeline.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing in the pipeline.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.pipeline.slice(0, 8).map((r) => (
                <li key={r.study.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <Link href={`/vc/studies/${r.study.id}`} className="hover:underline">
                    {r.study.question}
                  </Link>
                  <StatusBadge status={r.study.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          id="watch"
          title="Watchlists"
          actions={<Link href="/vc/watchlists" className="text-sm underline">Manage</Link>}
        >
          {d.watchlistSummary.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No watchlists yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.watchlistSummary.map((w) => (
                <li key={w.id} className="flex justify-between">
                  <span>{w.name}</span>
                  <span className="text-slate-500">{w.itemCount} followed</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-sm">
            <Link href="/vc/alerts" className="underline">
              {d.unreadAlerts} unread alert{d.unreadAlerts === 1 ? "" : "s"}
            </Link>
          </p>
        </Section>

        <Section
          id="reports"
          title="Recent reports"
          actions={<Link href="/vc/reports" className="text-sm underline">All reports</Link>}
        >
          {d.recentReports.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No saved reports yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.recentReports.map((r) => (
                <li key={r.id} className="flex justify-between gap-3 py-2 text-sm">
                  <Link href={`/vc/reports/${r.id}`} className="hover:underline">
                    {r.title}
                  </Link>
                  <span className="whitespace-nowrap text-xs text-slate-500">{formatDate(r.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
