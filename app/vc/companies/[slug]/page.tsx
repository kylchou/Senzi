import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyMetricsForm } from "@/components/vc/CompanyMetricsForm";
import { NewsList } from "@/components/vc/EvidenceList";
import { FollowButton } from "@/components/vc/FollowButton";
import { IndicatorChart } from "@/components/vc/IndicatorChart";
import { ProvenanceBadge, SOURCE_NAMES } from "@/components/vc/ProvenanceBadge";
import { Section } from "@/components/vc/Section";
import { StudyTable } from "@/components/vc/StudyTable";
import { db } from "@/lib/db";
import { DEMO_ORG_ID } from "@/lib/vc/constants";
import { formatShare } from "@/lib/vc/estimates";
import { formatDate, formatDateTime, formatIndicatorValue } from "@/lib/vc/format";
import { canProposeInActiveOrg } from "@/lib/vc/permissions";
import { companyModel } from "@/lib/vc/server/company-model";
import { getVcDeps, getVcServices } from "@/lib/vc/server/container";
import { requirePageContext } from "@/lib/vc/server/page";

const NEWS_LIMIT = 10;

/** Everything about one company: public signals over time, news, open markets, your firm's figures and questions. */
export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await requirePageContext(`/vc/companies/${slug}`);
  // Search links by id; everything else links by slug.
  const startup = await db.startup.findFirst({ where: { isPublished: true, OR: [{ slug }, { id: slug }] }, select: { id: true } });
  if (!startup) notFound();
  const services = getVcServices();
  const [data, studies, view, evidence] = await Promise.all([
    companyModel(ctx, startup.id),
    services.studies.list(ctx, { scope: "organization" }),
    services.watchlists.overview(ctx, startup.id),
    getVcDeps().platform.getStartupEvidence([startup.id]),
  ]);
  const own = studies
    .filter((r) => r.study.startupId === startup.id && r.permissions.viewLevel === "full")
    .map((r) => ({ ...r, startupName: data.startup.name, startupSlug: data.startup.slug }));
  const indicatorById = new Map(data.indicators.map((i) => [i.metricId, i]));
  const notCollected = data.indicators.filter((i) => i.value === null);
  const news = evidence.news.slice(0, NEWS_LIMIT);
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

      <Section
        title="Public indicators over time"
        description="Scraped from public sources and independent of trades. Each chart is one metric; hover or use the arrow keys to read a value."
      >
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
          <ProvenanceBadge provenance="scraped" />
          <span>Public data only. Your firm&apos;s own figures are in the separate section below.</span>
        </div>
        {data.history.length === 0 ? (
          <p className="text-sm text-slate-500">No public signals for this company yet. You can still enter your firm&apos;s figures below.</p>
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
                    <span>Crowd {formatShare(m.estimate?.generalPrice ?? null)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Sponsor-provided (your firm)"
        description="Entered by your firm, so you control it. Never shared with another organization, never used to resolve a question, and kept apart from the scraped data above."
      >
        {canEdit && <CompanyMetricsForm startupId={startup.id} metrics={data.metrics} demo={ctx.activeOrg?.organizationId === DEMO_ORG_ID} />}
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
          {!data.sponsor.length && <p className="text-sm text-slate-500">No figures entered yet.</p>}
        </div>
        {data.crossChecks.map((c) => (
          <p className="mt-3 text-xs text-slate-600 dark:text-slate-300" key={c.metricId}>
            {c.metricId}: {(c.sponsorChange * 100).toFixed(1)}% change vs {c.scrapedMetricId}:{" "}
            {c.scrapedChange === null ? "not enough comparable data" : `${(c.scrapedChange * 100).toFixed(1)}%`} ({c.from}–{c.to}). {c.note}
          </p>
        ))}
      </Section>

      <Section title="Your firm's questions" description="Open a row to see the three lines, the gaps between them and the evidence behind the model.">
        {own.length ? <StudyTable rows={own} /> : <p className="text-sm text-slate-500">No questions about this company yet.</p>}
      </Section>
    </div>
  );
}
