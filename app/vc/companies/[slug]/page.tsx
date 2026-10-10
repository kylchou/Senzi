import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePageContext } from "@/lib/vc/server/page";
import { companyModel } from "@/lib/vc/server/company-model";
import { getVcDeps, getVcServices } from "@/lib/vc/server/container";
import { canProposeInActiveOrg } from "@/lib/vc/permissions";
import { CompanyMetricsForm } from "@/components/vc/CompanyMetricsForm";
import { StudyTable } from "@/components/vc/StudyTable";
import { ThreeLineChart } from "@/components/vc/ThreeLineChart";
import { Section } from "@/components/vc/Section";

export default async function CompanyPage({params}: {params: Promise<{slug:string}>}) {
  const {slug} = await params;
  const ctx = await requirePageContext(`/vc/companies/${slug}`);
  const startup = await db.startup.findUnique({where:{slug},select:{id:true}});
  if (!startup) notFound();
  const [data, studies] = await Promise.all([companyModel(ctx,startup.id),getVcServices().studies.list(ctx,{scope:"organization"})]);
  const own = studies.filter(r=>r.study.startupId === startup.id && r.permissions.viewLevel === "full");
  const charts = await Promise.all(own.filter(r=>r.study.marketId).map(async r=>({...r,history:await getVcDeps().forecasting.getHistory(r.study.marketId!)})));
  return <div className="space-y-6">
    <header><h1 className="text-2xl font-semibold">{data.startup.name}</h1><p className="text-sm text-slate-500">Company signals and your organization?s private research.</p><Link className="text-sm underline" href="/vc/studies/new">Pose a question</Link></header>
    <Section title="Public indicators" description="Scraped signals, independent of trades. Missing signals stay unavailable."><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{data.indicators.map(i=><div className="rounded border p-3 text-sm" key={i.metricId}><h3 className="font-medium">{i.label}</h3><p>{i.value?.toLocaleString() ?? "Unavailable"} {i.unit}</p><p className="text-xs">{i.provenanceLabel} · As of {i.asOf ?? "unknown"}{i.simulated && " · SIMULATED"}</p>{i.sourceUrl && <a className="text-xs underline" href={i.sourceUrl} target="_blank" rel="noreferrer">Source</a>}{i.missingReason && <p className="text-xs">{i.missingReason}</p>}</div>)}</div>{!data.indicators.length && <p>No scraped indicators are available for this company yet. You can still enter private metrics below.</p>}</Section>
    <Section title="Your firm?s metrics" description="Sponsor-provided; never shared with another organization.">
      {canProposeInActiveOrg(ctx) && <CompanyMetricsForm startupId={startup.id} metrics={data.metrics} demo={ctx.activeOrg?.organizationId === "demo_org_vc"} />}
      <div className="mt-4 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>Metric</th><th>Value</th><th>Period / as of</th><th>Provenance / source note</th></tr></thead><tbody>{[...data.sponsor].reverse().map((p,i)=><tr className="border-t" key={i}><td className="py-2">{data.metrics.find(m=>m.id===p.metricId)?.label ?? p.metricId}</td><td>{p.value.toLocaleString()}</td><td>{p.periodStart}–{p.periodEnd}</td><td>Sponsor-provided{p.simulated && " · SIMULATED"}<br/>{p.note || "Entered by your firm"}</td></tr>)}</tbody></table>{!data.sponsor.length && <p className="text-sm text-slate-500">No private metrics entered yet.</p>}</div>
      {data.crossChecks.map(c=><p className="mt-3 text-xs" key={c.metricId}>{c.metricId}: {(c.sponsorChange*100).toFixed(1)}% change vs {c.scrapedMetricId}: {c.scrapedChange === null ? "not enough comparable data" : (c.scrapedChange*100).toFixed(1)+"%"} ({c.from}–{c.to}). {c.note}</p>)}
    </Section>
    <Section title="My questions">{own.length ? <StudyTable rows={own}/> : <p>No questions yet. Indicators and private metrics work without a market.</p>}</Section>
    {charts.map(r=><Section key={r.study.id} title={r.study.question}><ThreeLineChart marketId={r.study.marketId!} points={r.history} baseline={r.estimate?.openingBaseline?.value ?? null}/></Section>)}
  </div>;
}
