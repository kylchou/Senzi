import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { COMPANIES, FileModelStore, MemoryModelStore, getBaseline, makeQuestion, getCompanyIndicators, crossCheckSponsor, sponsorPoint } from "@/lib/model";
import type { DataPoint } from "@/lib/model/types";
import { intakeMetrics, intakeObservationSchema, intakeQuestionSchema } from "@/lib/model/intake";
import { canProposeInActiveOrg } from "../permissions";
import { forbidden, notFound, VcError } from "../errors";
import type { VcContext } from "../types";

export const structuredQuestionInput = z.object({
  startupId: z.string().min(1),
  target: intakeQuestionSchema,
  context: z.string().trim().max(5000).default(""),
  visibility: z.enum(["ORGANIZATION", "RESTRICTED", "PUBLIC"]).default("ORGANIZATION"),
  expectedVersion: z.number().int().positive().optional(),
}).strict();
export const companyMetricsInput = z.object({ observations: z.array(intakeObservationSchema).min(1).max(100) }).strict();

export function requireCompanyOrg(ctx: VcContext, write = false) {
  const org = ctx.activeOrg;
  if (!org || !ctx.memberships.some(m => m.organizationId === org.organizationId)) throw forbidden("Select your organization first");
  if (write && !canProposeInActiveOrg(ctx)) throw forbidden("Your role cannot enter metrics or propose questions");
  return org.organizationId;
}

export async function companyModel(ctx: VcContext, startupId: string, asOf = new Date()) {
  const organizationId = requireCompanyOrg(ctx);
  const startup = await db.startup.findFirst({ where: { id: startupId, isPublished: true }, select: { id: true, slug: true, name: true } });
  if (!startup) throw notFound("Startup");
  // Only catalog identifiers reach the filesystem; never a user-supplied path.
  const company = COMPANIES.find(c => c.id === startup.slug);
  const scraped = company ? new FileModelStore().readPoints(company.id).filter(p => p.provenance === "scraped" && !p.simulated) : [];
  const rows = await db.modelDataPoint.findMany({ where: { startupId, organizationId, provenance: "SPONSOR_PROVIDED", availableAt: { lte: asOf } }, orderBy: [{ periodEnd: "asc" }, { availableAt: "asc" }] });
  const sponsor: DataPoint[] = rows.map(r => ({ companyId: company?.id ?? startup.slug, metricId: r.metricId, source: "sponsor", value: r.value, periodStart: r.periodStart.toISOString().slice(0, 10), periodEnd: r.periodEnd.toISOString().slice(0, 10), availableAt: r.availableAt.toISOString(), fetchedAt: r.fetchedAt.toISOString(), sourceUrl: r.sourceUrl, provenance: "sponsor_provided", simulated: r.simulated, ...(r.note ? { note: r.note } : {}) }));
  const metrics = intakeMetrics(startup);
  const questionMetrics = metrics.filter(m => m.kind === "weekly_total");
  const indicators = company ? getCompanyIndicators(company.id, scraped, [], asOf).filter(i => i.provenance === "scraped") : [];
  const crossChecks = questionMetrics[0] ? crossCheckSponsor(sponsor, scraped, questionMetrics[0].id, asOf) : [];
  return { startup, company, metrics, questionMetrics, scraped, sponsor, indicators, crossChecks };
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

export async function priceQuestion(ctx: VcContext, raw: unknown) {
  requireCompanyOrg(ctx, true);
  const input = structuredQuestionInput.parse(raw);
  const asOf = new Date();
  const data = await companyModel(ctx, input.startupId, asOf);
  if (!data.company || !data.questionMetrics.some(m => m.id === input.target.metricId)) throw new VcError("VALIDATION_ERROR", "This metric has no independent resolution connector. Enter it as a company indicator instead.");
  if (input.target.targetDate <= asOf.toISOString().slice(0, 10)) throw new VcError("VALIDATION_ERROR", "Choose a future window end date");
  const question = makeQuestion({ id: "vc-preview", companyId: data.company.id, metricId: input.target.metricId, threshold: input.target.threshold, windowEnd: input.target.targetDate, opensAt: asOf.toISOString() });
  const result = getBaseline(question.id, { asOf, store: new MemoryModelStore(data.scraped, data.sponsor, [question]) });
  const metric = data.questionMetrics.find(m => m.id === question.metricId)!;
  const criteria = `${metric.label}: the public source reports a complete seven-day total ending ${question.windowEnd} (UTC)`;
  const methodology = `${result.method.name}@${result.method.version}. As of ${result.asOf}. Model uncertainty: ${result.low}–${result.high}. Inputs: ${result.inputsUsed.map(i => `${i.metricId} (${i.provenance}${i.simulated ? ", SIMULATED" : ""}, ${i.points} points, ${i.periodStart}–${i.periodEnd})`).join("; ")}. Hash ${result.method.details.inputsHash}. Robust log-weekly trend; only matching history affects the model. Scraped values take precedence; sponsor values fill missing weeks. Trades never feed the model.`.slice(0, 1000);
  return { input, question, result, fields: {
    startupId: input.startupId, question: question.text,
    yesCriteria: `${criteria} of at least ${question.threshold}. Source: ${question.resolutionSource.url}`,
    noCriteria: `${criteria} below ${question.threshold}. Missing or disputed data requires review; sponsor entries never resolve the outcome.`,
    context: input.context, visibility: input.visibility,
    deadline: new Date(`${question.windowEnd}T23:59:59.999Z`),
    baselineValue: result.probability,
    baselineMethodology: result.probability === null ? null : methodology,
    sources: [{ url: question.resolutionSource.url, title: `Resolution: ${metric.label}`, publisher: question.resolutionSource.source, publishedAt: null }],
  } };
}
