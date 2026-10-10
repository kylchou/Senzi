import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyMetricsForm } from "@/components/vc/CompanyMetricsForm";
import { FollowButton } from "@/components/vc/FollowButton";
import { Section } from "@/components/vc/Section";
import { StudyTable } from "@/components/vc/StudyTable";
import { ThreeLineChart } from "@/components/vc/ThreeLineChart";
import { db } from "@/lib/db";
import { formatShare } from "@/lib/vc/estimates";
import { formatDate } from "@/lib/vc/format";
import { canProposeInActiveOrg } from "@/lib/vc/permissions";
import { companyModel } from "@/lib/vc/server/company-model";
import { getVcDeps, getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

/** Everything about one company: public signals, open markets, your firm's figures and questions. */
export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageContext(`/vc/companies/${slug}`);
  // Search links by id; everything else links by slug.
  const startup = await db.startup.findFirst({ where: { isPublished: true, OR: [{ slug }, { id: slug }] }, select: { id: true } });
  if (!startup) notFound();
  const services = getVcServices();
  const [data, studies, view] = await Promise.all([
    companyModel(ctx, startup.id),
    services.studies.list(ctx, { scope: "organization" }),
    services.watchlists.overview(ctx, startup.id),
  ]);
  const own = studies.filter((r) => r.study.startupId === startup.id && r.permissions.viewLevel === "full");
  const charts = await Promise.all(
    own.filter((r) => r.study.marketId).map(async (r) => ({ ...r, history: await getVcDeps().forecasting.getHistory(r.study.marketId!) })),
  );
  const openMarkets = view.selected?.openMarkets ?? [];
  const canEdit = canProposeInActiveOrg(ctx);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm">
            <Link href="/vc/companies" className="text-slate-500 hover:underline">
              Companies
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">{data.startup.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && <FollowButton target={{ type: "STARTUP", startupId: startup.id }} following={view.selected?.following ?? false} />}
          <Link
            href={`/vc/compare?ids=${startup.id}`}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Compare with…
          </Link>
          {canEdit && (
            <Link
              href="/vc/studies/new"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
            >
              Ask a question
            </Link>
          )}
        </div>
      </header>

      <Section title="Public signals" description="Scraped from public sources, independent of trading. Missing signals stay unavailable.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.indicators.map((i) => (
            <div className="rounded border border-slate-200 p-3 text-sm dark:border-slate-800" key={i.metricId}>
              <h3 className="font-medium">{i.label}</h3>
              <p>
                {i.value?.toLocaleString() ?? "Unavailable"} {i.unit}
              </p>
              <p className="text-xs text-slate-500">
                {i.provenanceLabel} · As of {i.asOf ?? "unknown"}
                {i.simulated && " · SIMULATED"}
              </p>
              {i.sourceUrl && (
                <a className="text-xs underline" href={i.sourceUrl} target="_blank" rel="noreferrer">
                  Source
                </a>
              )}
              {i.missingReason && <p className="text-xs">{i.missingReason}</p>}
            </div>
          ))}
        </div>
        {!data.indicators.length && <p className="text-sm text-slate-500">No public signals for this company yet. You can still enter your firm&apos;s figures below.</p>}
      </Section>

      <Section title="Open markets" description="Open questions on this company that your firm can see.">
        {openMarkets.length === 0 ? (
          <p className="text-sm text-slate-500">No open markets right now.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-900">
            {openMarkets.map((m) => {
              const href = m.kind === "study" ? `/vc/studies/${m.study.id}` : m.market.slug ? `/markets/${m.market.slug}` : null;
              const question = m.kind === "study" ? m.study.question : m.market.question;
              const closes = m.kind === "study" ? m.study.deadline : m.market.closesAt;
              return (
                <li key={m.kind === "study" ? m.study.id : m.market.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
                  <span className="min-w-0 flex-1">
                    {href ? (
                      <Link href={href} className="font-medium hover:underline">
                        {question}
                      </Link>
                    ) : (
                      <span className="font-medium">{question}</span>
                    )}
                    <span className="block text-xs text-slate-500">
                      {m.kind === "study" ? "Research question" : "Community market"}
                      {closes && ` · closes ${formatDate(closes)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 gap-3 text-xs tabular-nums text-slate-600 dark:text-slate-300">
                    <span>Model {formatShare(m.estimate?.modelValue ?? m.estimate?.openingBaseline?.value ?? null)}</span>
                    <span>Market {formatShare(m.estimate?.generalPrice ?? null)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Your firm's figures" description="Entered by your firm and never shared with another organization. They can inform the model but never resolve a question.">
        {canEdit && <CompanyMetricsForm startupId={startup.id} metrics={data.metrics} demo={ctx.activeOrg?.organizationId === "demo_org_vc"} />}
        <div className="mt-4 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Value</th>
                <th>Period / as of</th>
                <th>Provenance / source note</th>
              </tr>
            </thead>
            <tbody>
              {[...data.sponsor].reverse().map((p, i) => (
                <tr className="border-t" key={i}>
                  <td className="py-2">{data.metrics.find((m) => m.id === p.metricId)?.label ?? p.metricId}</td>
                  <td>{p.value.toLocaleString()}</td>
                  <td>
                    {p.periodStart}–{p.periodEnd}
                  </td>
                  <td>
                    Sponsor-provided{p.simulated && " · SIMULATED"}
                    <br />
                    {p.note || "Entered by your firm"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.sponsor.length && <p className="text-sm text-slate-500">No figures entered yet.</p>}
        </div>
        {data.crossChecks.map((c) => (
          <p className="mt-3 text-xs" key={c.metricId}>
            {c.metricId}: {(c.sponsorChange * 100).toFixed(1)}% change vs {c.scrapedMetricId}:{" "}
            {c.scrapedChange === null ? "not enough comparable data" : (c.scrapedChange * 100).toFixed(1) + "%"} ({c.from}–{c.to}). {c.note}
          </p>
        ))}
      </Section>

      <Section title="Your firm's questions">
        {own.length ? <StudyTable rows={own} /> : <p className="text-sm text-slate-500">No questions about this company yet.</p>}
      </Section>
      {charts.map((r) => (
        <Section key={r.study.id} title={r.study.question}>
          <ThreeLineChart marketId={r.study.marketId!} points={r.history} baseline={r.estimate?.openingBaseline?.value ?? null} />
        </Section>
      ))}
    </div>
  );
}
