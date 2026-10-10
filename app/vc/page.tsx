import Link from "next/link";
import { EmptyState } from "@/components/vc/EmptyState";
import { NoWorkspace } from "@/components/vc/NoWorkspace";
import { Section } from "@/components/vc/Section";
import { StudyTable } from "@/components/vc/StudyTable";
import { ALLOCATION_SHARE_EXPLAINER } from "@/lib/vc/constants";
import { STATUS_LABELS, formatDate, formatDateTime, formatRelative } from "@/lib/vc/format";
import { getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";
import type { StudyStatus, StudyVisibility } from "@/lib/vc/types";

const COUNT_ORDER: StudyStatus[] = ["OPEN", "SUBMITTED", "RESOLVED"];

/** Active-studies filter. "Verified users" means invited participants only; "Public" means anyone can trade. */
const AUDIENCES = [
  { key: "public", label: "Public", visibility: "PUBLIC" },
  { key: "verified", label: "Verified users", visibility: "RESTRICTED" },
] as const satisfies readonly { key: string; label: string; visibility: StudyVisibility }[];
const MIN_PARTICIPANT_OPTIONS = [3, 5, 10] as const;

type Audience = (typeof AUDIENCES)[number]["key"];

function parseFilters(raw: Record<string, string | string[] | undefined>) {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const audience = AUDIENCES.find((a) => a.key === pick(raw.audience))?.key;
  const min = MIN_PARTICIPANT_OPTIONS.find((n) => String(n) === pick(raw.min));
  return { audience, min };
}

const chipClass = (active: boolean) =>
  `rounded-full px-2.5 py-1 ring-1 ring-inset ${
    active
      ? "bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900"
      : "ring-slate-300 hover:bg-slate-50 dark:ring-slate-700 dark:hover:bg-slate-900"
  }`;

export default async function VcDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await requirePageContext("/vc");
  if (!ctx.activeOrg) return <NoWorkspace />;
  const filters = parseFilters(await searchParams);
  const d = await getVcServices().dashboard.get(ctx);

  const href = (next: { audience?: Audience; min?: number }) => {
    const params = new URLSearchParams();
    if (next.audience) params.set("audience", next.audience);
    if (next.min) params.set("min", String(next.min));
    const qs = params.toString();
    return `/vc${qs ? `?${qs}` : ""}#active`;
  };

  const visibility = AUDIENCES.find((a) => a.key === filters.audience)?.visibility;
  const activeStudies = d.activeStudies.filter(
    (r) =>
      (!visibility || r.study.visibility === visibility) &&
      (!filters.min || (r.estimate?.participantCount ?? 0) >= filters.min),
  );
  const filtered = !!filters.audience || !!filters.min;

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

      <dl className="grid grid-cols-3 gap-3">
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
        <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by who can trade">
            <span className="mr-1 text-slate-500 dark:text-slate-400">Traders</span>
            <Link href={href({ min: filters.min })} className={chipClass(!filters.audience)} scroll={false}>
              All
            </Link>
            {AUDIENCES.map((a) => (
              <Link
                key={a.key}
                href={href({ audience: a.key, min: filters.min })}
                className={chipClass(filters.audience === a.key)}
                aria-current={filters.audience === a.key ? "true" : undefined}
                scroll={false}
              >
                {a.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by number of participants">
            <span className="mr-1 text-slate-500 dark:text-slate-400">Participants</span>
            <Link href={href({ audience: filters.audience })} className={chipClass(!filters.min)} scroll={false}>
              Any
            </Link>
            {MIN_PARTICIPANT_OPTIONS.map((n) => (
              <Link
                key={n}
                href={href({ audience: filters.audience, min: n })}
                className={chipClass(filters.min === n)}
                aria-current={filters.min === n ? "true" : undefined}
                scroll={false}
              >
                {n}+
              </Link>
            ))}
          </div>
        </div>

        {d.activeStudies.length === 0 ? (
          <EmptyState title="No open studies" action={{ href: "/vc/studies/new", label: "Propose a study" }}>
            Studies open for forecasting after platform review.
          </EmptyState>
        ) : activeStudies.length === 0 && filtered ? (
          <EmptyState title="No studies match these filters" action={{ href: href({}), label: "Clear filters" }}>
            Try a lower participant count or a different trader group.
          </EmptyState>
        ) : (
          <StudyTable
            rows={activeStudies.map((r) => ({
              study: r.study,
              estimate: r.estimate,
              startupName: r.startupName,
              startupSlug: r.startupSlug,
              baselineValue: r.baseline.value,
            }))}
          />
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
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
        </Section>
      </div>
    </div>
  );
}
