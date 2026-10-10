import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { COMPANIES, FileModelStore, getCompanyIndicators, getIndicatorHistory, crossCheckSponsor, metricsFor, sponsorPoint, type Indicator } from "@/lib/model";
import { SPONSOR_METRIC_LABELS, type SponsorMetricKind } from "@/lib/model/sponsor";
import type { DataPoint, InputUsed, MethodInfo, SourceRef } from "@/lib/model/types";
import { intakeMetrics, intakeObservationSchema } from "@/lib/model/intake";
import { canProposeInActiveOrg } from "../permissions";
import { forbidden, notFound, VcError } from "../errors";
import type { VcContext } from "../types";

export const companyMetricsInput = z.object({ observations: z.array(intakeObservationSchema).min(1).max(100) }).strict();

export function requireCompanyOrg(ctx: VcContext, write = false) {
  const org = ctx.activeOrg;
  if (!org || !ctx.memberships.some(m => m.organizationId === org.organizationId)) throw forbidden("Select your organization first");
  if (write && !canProposeInActiveOrg(ctx)) throw forbidden("Your role cannot enter metrics or propose questions");
  return org.organizationId;
}

/** Real scraped points for a catalog company. Only catalog identifiers reach the filesystem; never a user-supplied path. */
function scrapedPoints(companyId: string | undefined): DataPoint[] {
  return companyId ? new FileModelStore().readPoints(companyId).filter(p => p.provenance === "scraped" && !p.simulated) : [];
}

/** One firm's sponsor-provided points for a startup. Private to that firm. */
async function sponsorPoints(startupId: string, organizationId: string, companyId: string, asOf: Date): Promise<DataPoint[]> {
  const rows = await db.modelDataPoint.findMany({ where: { startupId, organizationId, provenance: "SPONSOR_PROVIDED", availableAt: { lte: asOf } }, orderBy: [{ periodEnd: "asc" }, { availableAt: "asc" }] });
  return rows.map(r => ({ companyId, metricId: r.metricId, source: "sponsor", value: r.value, periodStart: r.periodStart.toISOString().slice(0, 10), periodEnd: r.periodEnd.toISOString().slice(0, 10), availableAt: r.availableAt.toISOString(), fetchedAt: r.fetchedAt.toISOString(), sourceUrl: r.sourceUrl, provenance: "sponsor_provided", simulated: r.simulated, ...(r.note ? { note: r.note } : {}) }));
}

export async function companyModel(ctx: VcContext, startupId: string, asOf = new Date()) {
  const organizationId = requireCompanyOrg(ctx);
  const startup = await db.startup.findFirst({ where: { id: startupId, isPublished: true }, select: { id: true, slug: true, name: true } });
  if (!startup) throw notFound("Startup");
  const company = COMPANIES.find(c => c.id === startup.slug);
  const scraped = scrapedPoints(company?.id);
  const sponsor = await sponsorPoints(startupId, organizationId, company?.id ?? startup.slug, asOf);
  const metrics = intakeMetrics(startup);
  const questionMetrics = metrics.filter(m => m.kind === "weekly_total");
  const indicators = company ? getCompanyIndicators(company.id, scraped, [], asOf).filter(i => i.provenance === "scraped") : [];
  const crossChecks = questionMetrics[0] ? crossCheckSponsor(sponsor, scraped, questionMetrics[0].id, asOf) : [];
  const history = company ? getIndicatorHistory(company.id, scraped, asOf) : [];
  return { startup, company, metrics, questionMetrics, scraped, sponsor, indicators, history, crossChecks };
}

export interface ModelInputRow extends InputUsed {
  label: string;
  /** Where the input came from and when it was fetched, when the snapshot recorded it. */
  sourceRef: SourceRef | null;
}

export interface ModelCalculation {
  /** What the question counts, and the line it has to clear. */
  metricLabel: string | null;
  unit: string | null;
  /** False for ranks, where YES means at or below the threshold. */
  higherIsBetter: boolean;
  threshold: number | null;
  windowEnd: string | null;
  lastWeek: { windowEnd: string; total: number } | null;
  weeksUsed: number;
  weeklyGrowth: number | null;
  horizonWeeks: number | null;
  forecastMedian: number | null;
  forecastRange80: [number, number] | null;
  /** Probability before the pull toward 50%; null when it matches the final value. */
  rawProbability: number | null;
  /** True when the forecast was adjusted for npm-wide download shifts. */
  npmAdjusted: boolean;
  /** Raw method internals, for the "Technical details" dropdown. */
  technical: ModelTechnical;
}

export interface ModelTechnical {
  methodName: string | null;
  methodVersion: string | null;
  bootstrapReplicates: number | null;
  /** Fingerprint of the exact inputs, so a result can be reproduced and audited. */
  inputsHash: string | null;
}

export interface StudyModelEvidence {
  /** The latest model snapshot for the market; null before the model has run. */
  model: {
    probability: number | null;
    low: number | null;
    high: number | null;
    confidence: string | null;
    asOf: Date;
    dataThrough: Date | null;
    method: string;
    inputs: ModelInputRow[];
    notes: string[];
    missing: string[];
    /** The numbers behind the result, in plain terms. Null fields mean the method didn't produce that number. */
    calc: ModelCalculation;
  } | null;
  /** Scraped public signals for the company. Context unless listed in model.inputs. */
  scraped: Indicator[];
  /** The viewer's own firm's sponsor-provided figures. Never another firm's. */
  sponsor: Indicator[];
}

/**
 * Why the model says what it says for one study: the inputs the latest
 * snapshot used, every scraped signal with source and fetch time, and the
 * viewer's own firm's sponsor-provided figures, kept separate.
 */
export async function studyModelEvidence(ctx: VcContext, startupId: string, marketId: string | null, asOf = new Date()): Promise<StudyModelEvidence> {
  const startup = await db.startup.findUnique({ where: { id: startupId }, select: { slug: true } });
  const company = startup ? COMPANIES.find(c => c.id === startup.slug) : undefined;
  const orgId = ctx.activeOrg && ctx.memberships.some(m => m.organizationId === ctx.activeOrg!.organizationId) ? ctx.activeOrg.organizationId : null;
  const [sponsor, snapshot] = await Promise.all([
    company && orgId ? sponsorPoints(startupId, orgId, company.id, asOf) : Promise.resolve([]),
    marketId ? db.modelBaselineSnapshot.findFirst({ where: { marketId }, orderBy: { createdAt: "desc" } }) : Promise.resolve(null),
  ]);
  const spec = marketId ? await db.modelQuestionSpec.findUnique({ where: { marketId } }) : null;
  const indicators = company ? getCompanyIndicators(company.id, scrapedPoints(company.id), sponsor, asOf) : [];
  const labels = new Map<string, string>([
    ...(company ? metricsFor(company).map(m => [m.id, m.label] as const) : []),
    ...(Object.keys(SPONSOR_METRIC_LABELS) as SponsorMetricKind[]).map(k => [`sponsor_${k}`, SPONSOR_METRIC_LABELS[k].label] as const),
  ]);
  const sources = (snapshot?.sources ?? []) as unknown as SourceRef[];
  const inputs = ((snapshot?.inputsUsed ?? []) as unknown as InputUsed[]).map(i => ({
    ...i,
    label: labels.get(i.metricId) ?? i.metricId,
    sourceRef: sources.find(s => s.source === i.source) ?? null,
  }));
  const method = snapshot ? `${snapshot.modelName}@${snapshot.modelVersion}` : "";
  const methodInfo = snapshot?.method as unknown as MethodInfo | null;
  const details = methodInfo?.details;
  const metric = spec && company ? metricsFor(company).find(m => m.id === spec.metricId) : undefined;
  const raw = details?.rawProbability ?? null;
  const calc: ModelCalculation = {
    metricLabel: metric?.label ?? (spec ? labels.get(spec.metricId) ?? spec.metricId : null),
    unit: metric?.unit ?? null,
    higherIsBetter: metric?.higherIsBetter ?? true,
    threshold: spec?.threshold ?? null,
    windowEnd: spec ? spec.windowEnd.toISOString().slice(0, 10) : null,
    lastWeek: details?.lastObservedWeek ?? null,
    weeksUsed: details?.weeksUsed ?? 0,
    weeklyGrowth: details?.weeklyGrowth ?? null,
    horizonWeeks: details?.horizonWeeks ?? null,
    forecastMedian: details?.forecastMedian ?? null,
    forecastRange80: details?.forecastRange80 ?? null,
    rawProbability: raw != null && snapshot?.probability != null && Math.abs(raw - snapshot.probability) >= 0.005 ? raw : null,
    npmAdjusted: !!details?.npmIndex,
    technical: {
      methodName: methodInfo?.name ?? null,
      methodVersion: methodInfo?.version ?? null,
      bootstrapReplicates: details?.bootstrapReplicates ?? null,
      inputsHash: details?.inputsHash ?? snapshot?.inputsHash ?? null,
    },
  };
  return {
    model: snapshot && {
      probability: snapshot.probability,
      low: snapshot.low,
      high: snapshot.high,
      confidence: snapshot.confidence,
      asOf: snapshot.asOf,
      dataThrough: snapshot.dataThrough,
      method,
      inputs,
      notes: snapshot.notes,
      missing: snapshot.missing,
      calc,
    },
    scraped: indicators.filter(i => i.provenance === "scraped"),
    sponsor: indicators.filter(i => i.provenance === "sponsor_provided" && i.value !== null),
  };
}

export async function saveCompanyMetrics(ctx: VcContext, startupId: string, raw: unknown) {
  const organizationId = requireCompanyOrg(ctx, true);
  const { observations } = companyMetricsInput.parse(raw);
  const data = await companyModel(ctx, startupId);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const keys = new Set<string>();
  const writes = observations.map(o => {
    const metric = data.metrics.find(m => m.id === o.metricId);
    if (!metric || o.periodEnd > today || (metric.kind === "snapshot" && o.periodStart !== o.periodEnd) || (metric.kind === "weekly_total" && Date.parse(o.periodEnd) - Date.parse(o.periodStart) !== 6 * 86400000)) throw new VcError("VALIDATION_ERROR", "Choose a supported metric and a completed period (one date for a KPI, seven days for downloads)");
    const key = `${o.metricId}:${o.periodStart}:${o.periodEnd}`;
    if (keys.has(key)) throw new VcError("VALIDATION_ERROR", "Duplicate metric period in this request");
    keys.add(key);
    const p = sponsorPoint({ companyId: data.startup.slug, metric: { metricId: o.metricId }, value: o.value, periodStart: o.periodStart, periodEnd: o.periodEnd, enteredAt: now.toISOString(), simulated: o.simulated || organizationId === "demo_org_vc", note: o.note });
    return { startupId, metricId: p.metricId, source: "SPONSOR" as const, value: p.value, periodStart: new Date(p.periodStart), periodEnd: new Date(p.periodEnd), availableAt: now, fetchedAt: now, sourceUrl: p.sourceUrl, provenance: "SPONSOR_PROVIDED" as const, simulated: p.simulated, note: p.note, organizationId, enteredById: ctx.user.id };
  });
  // A repeat is a correction to this organization's observation, never another firm's.
  await db.$transaction(writes.map(data => db.modelDataPoint.upsert({
    where: { startupId_metricId_source_periodStart_periodEnd_organizationId: { startupId, metricId: data.metricId, source: data.source, periodStart: data.periodStart, periodEnd: data.periodEnd, organizationId } },
    create: data, update: data,
  })));
  return companyModel(ctx, startupId);
}
