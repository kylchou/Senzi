import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePageContext } from "@/lib/vc/server/page";
import { companyModel } from "@/lib/vc/server/company-model";
import { getVcDeps, getVcServices } from "@/lib/vc/server/container";
import { canProposeInActiveOrg } from "@/lib/vc/permissions";
import { DEMO_ORG_ID } from "@/lib/vc/constants";
import { formatDate, formatDateTime, formatIndicatorValue } from "@/lib/vc/format";
import { CompanyMetricsForm } from "@/components/vc/CompanyMetricsForm";
import { NewsList } from "@/components/vc/EvidenceList";
import { IndicatorChart } from "@/components/vc/IndicatorChart";
import { ProvenanceBadge, SOURCE_NAMES } from "@/components/vc/ProvenanceBadge";
import { Section } from "@/components/vc/Section";
import { StudyTable } from "@/components/vc/StudyTable";

const NEWS_LIMIT = 10;

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageContext(`/vc/companies/${slug}`);
  const startup = await db.startup.findUnique({ where: { slug }, select: { id: true } });
  if (!startup) notFound();
  const [data, studies, evidence] = await Promise.all([
    companyModel(ctx, startup.id),
    getVcServices().studies.list(ctx, { scope: "organization" }),
    getVcDeps().platform.getStartupEvidence([startup.id]),
  ]);
  const own = studies
    .filter((r) => r.study.startupId === startup.id && r.permissions.viewLevel === "full")
    .map((r) => ({ ...r, startupName: data.startup.name, startupSlug: data.startup.slug }));
  const indicatorById = new Map(data.indicators.map((i) => [i.metricId, i]));
  const notCollected = data.indicators.filter((i) => i.value === null);
  const news = evidence.news.slice(0, NEWS_LIMIT);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{data.startup.name}</h1>
        <p className="text-sm text-slate-500">Company signals and your organization&apos;s private research.</p>
        <Link className="text-sm underline" href="/vc/studies/new">
          Pose a question
        </Link>
      </header>

      <Section
        title="Public indicators over time"
        description="Scraped from public sources and independent of trades. Each chart is one metric; hover or use the arrow keys to read a value."
      >
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          <ProvenanceBadge provenance="scraped" />
          <span>Public data only. Your firm&apos;s own figures are in the separate section below.</span>
        </div>
        {data.history.length === 0 ? (
          <p className="text-sm text-slate-500">No scraped indicators are available for this company yet. You can still enter private metrics below.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.history.map((h) => (
              <IndicatorChart
                key={h.metricId}
                label={h.label}
                unit={h.unit}
                higherIsBetter={h.higherIsBetter}
                sourceName={SOURCE_NAMES[h.source] ?? h.source}
                sourceUrl={h.sourceUrl}
                fetchedAt={h.fetchedAt}
                change4w={indicatorById.get(h.metricId)?.change4w ?? null}
                points={h.points}
              />
            ))}
          </ul>
        )}
        {notCollected.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Not collected: {notCollected.map((i) => `${i.label}${i.missingReason ? ` (${i.missingReason})` : ""}`).join("; ")}.
          </p>
        )}
      </Section>

      <Section title="News" description="Public articles about this company, each marked verified, unverified or disputed.">
        <NewsList news={news} emptyText="No articles recorded for this company yet." />
      </Section>

      <Section
        title="Sponsor-provided (your firm)"
        description="Entered by your firm, so you control it. Never shared with another organization, never used to resolve a question, and kept apart from the scraped data above."
      >
        {canProposeInActiveOrg(ctx) && <CompanyMetricsForm startupId={startup.id} metrics={data.metrics} demo={ctx.activeOrg?.organizationId === DEMO_ORG_ID} />}
        <div className="mt-4 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1 pr-2 font-medium">Metric</th>
                <th className="px-2 py-1 font-medium">Value</th>
                <th className="px-2 py-1 font-medium">Period</th>
                <th className="px-2 py-1 font-medium">Provenance</th>
                <th className="py-1 pl-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {[...data.sponsor].reverse().map((p, i) => {
                const metric = data.metrics.find((m) => m.id === p.metricId);
                return (
                  <tr className="border-t border-slate-100 align-top dark:border-slate-900" key={i}>
                    <td className="py-2 pr-2">{metric?.label ?? p.metricId}</td>
                    <td className="px-2 py-2 tabular-nums">{formatIndicatorValue(p.value, metric?.unit ?? "")}</td>
                    <td className="px-2 py-2 text-xs text-slate-600 dark:text-slate-300">
                      {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                      <span className="block text-slate-500">entered {formatDateTime(p.fetchedAt)}</span>
                    </td>
                    <td className="px-2 py-2">
                      <ProvenanceBadge provenance="sponsor_provided" simulated={p.simulated} />
                    </td>
                    <td className="py-2 pl-2 text-xs text-slate-600 dark:text-slate-300">{p.note || "Entered by your firm"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!data.sponsor.length && <p className="text-sm text-slate-500">No private metrics entered yet.</p>}
        </div>
        {data.crossChecks.map((c) => (
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-300" key={c.metricId}>
            {c.metricId}: {(c.sponsorChange * 100).toFixed(1)}% change vs {c.scrapedMetricId}:{" "}
            {c.scrapedChange === null ? "not enough comparable data" : `${(c.scrapedChange * 100).toFixed(1)}%`} ({c.from}–{c.to}). {c.note}
          </p>
        ))}
      </Section>

      <Section title="Your questions" description="Open a row to see the three lines, the gaps between them and the evidence behind the model.">
        {own.length ? (
          <StudyTable rows={own} />
        ) : (
          <p className="text-sm text-slate-500">No questions yet. Indicators and private metrics work without a market.</p>
        )}
      </Section>
    </div>
  );
}
