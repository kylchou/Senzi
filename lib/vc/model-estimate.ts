/**
 * Runs the baseline model (lib/model computeDirectBaseline) for a study's
 * measurable question. Pure apart from reading the model's data files, so the
 * app (server/model-adapter.ts) and the demo seed price questions identically.
 */
import { COMPANIES, type ModelStore } from "@/lib/model";
import { computeDirectBaseline } from "@/lib/model/direct-baseline";
import { intakeMetrics, questionTextFor, resolutionUrlFor, type IntakeMetric } from "@/lib/model/intake";
import { sponsorPoint } from "@/lib/model/sponsor";
import { baselineMethodology } from "@/lib/model/study-baseline";
import type { DataPoint } from "@/lib/model/types";
import { OPENING_LINE_MODEL_NAME, clampProbability, confidenceFor, criteriaFor } from "./opening-line";
import type { FirmObservation, MetricLink, ModelEstimate, OpeningLineMetric } from "./types";

export function companyFor(startup: { slug: string; name: string }) {
  const name = startup.name.trim().toLowerCase();
  return COMPANIES.find((c) => c.id === startup.slug) ?? COMPANIES.find((c) => c.name.toLowerCase() === name) ?? null;
}

/** The firm's figures as model data points. Entry time is stored, so the inputs hash is stable across runs. */
function firmPoints(companyId: string, observations: FirmObservation[]): DataPoint[] {
  return observations.map((o) =>
    sponsorPoint({
      companyId,
      metric: { metricId: o.metricId },
      value: o.value,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      enteredAt: o.availableAt ?? `${o.periodEnd}T23:59:59.999Z`,
      simulated: o.simulated ?? false,
      ...(o.note ? { note: o.note } : {}),
    }),
  );
}

/**
 * Metrics a question can be linked to: only those an independent public source
 * resolves (today, weekly package downloads). Firm-only KPIs such as ARR can
 * inform the company page but never price or resolve a market.
 */
function resolvableMetrics(startup: { slug: string; name: string }): IntakeMetric[] {
  return intakeMetrics(startup).filter((m) => m.sourceUrl !== null);
}

/** Metrics the model can forecast for a startup, and whether public data feeds each. */
export function modelMetricsFor(store: ModelStore, startup: { slug: string; name: string }): (OpeningLineMetric & { metric: IntakeMetric })[] {
  const company = companyFor(startup);
  const publicIds = new Set(company ? store.readPoints(company.id).map((p) => p.metricId) : []);
  return resolvableMetrics(startup).map((metric) => ({
    id: metric.id,
    label: metric.label,
    unit: metric.unit,
    kind: metric.kind,
    hasPublicData: publicIds.has(metric.id),
    metric,
  }));
}

export function estimateWithModel(
  store: ModelStore,
  { startup, link, observations, asOf }: { startup: { id: string; name: string; slug: string }; link: MetricLink; observations: FirmObservation[]; asOf: Date },
): ModelEstimate {
  const company = companyFor(startup);
  const companyId = company?.id ?? startup.slug;
  const metric = resolvableMetrics(startup).find((m) => m.id === link.metricId);
  const base: ModelEstimate = {
    status: "INSUFFICIENT_DATA",
    link,
    probability: null,
    low: null,
    high: null,
    confidence: null,
    modelName: OPENING_LINE_MODEL_NAME,
    modelVersion: "direct-metric",
    inputsHash: null,
    methodology: null,
    notes: [],
    inputsUsed: [],
    question: null,
    yesCriteria: null,
    noCriteria: null,
    resolutionSource: null,
    asOf,
  };
  if (!metric) return { ...base, notes: [`No metric "${link.metricId}" with a public resolution source exists for ${startup.name}.`] };

  const question = { metricId: link.metricId, threshold: link.threshold, targetDate: link.targetDate };
  const resolutionUrl = resolutionUrlFor(metric, question);
  const wording = {
    resolutionSource: resolutionUrl ? { url: resolutionUrl, title: `Resolution: ${metric.label}` } : null,
    question: questionTextFor(startup.name, metric, question),
    ...criteriaFor({
      startupName: startup.name,
      metricLabel: metric.label,
      unit: metric.unit,
      kind: metric.kind,
      threshold: link.threshold,
      targetDate: link.targetDate,
      resolutionUrl,
    }),
  };

  let direct: ReturnType<typeof computeDirectBaseline>;
  try {
    const points = [...(company ? store.readPoints(company.id) : []), ...firmPoints(companyId, observations)];
    direct = computeDirectBaseline(companyId, question, metric, points, asOf);
  } catch (err) {
    return { ...base, ...wording, notes: [err instanceof Error ? err.message : "The model couldn't read this question."] };
  }

  const result: ModelEstimate = {
    ...base,
    ...wording,
    modelVersion: direct.modelVersion,
    inputsHash: direct.inputsHash,
    notes: direct.notes,
    inputsUsed: direct.inputsUsed.map((p) => ({ ...p })),
  };
  if (direct.status !== "ok" || direct.probability == null || direct.low == null || direct.high == null) return result;

  const probability = clampProbability(direct.probability);
  const low = Math.min(clampProbability(direct.low), probability);
  const high = Math.max(clampProbability(direct.high), probability);
  return {
    ...result,
    status: "OK",
    probability,
    low,
    high,
    confidence: confidenceFor({
      low,
      high,
      limitedHistory: direct.notes.some((n) => n.startsWith("Limited history")),
      usesFirmData: direct.inputsUsed.some((p) => p.provenance !== "scraped"),
    }),
    methodology: baselineMethodology(direct),
  };
}
