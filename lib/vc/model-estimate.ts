/**
 * Runs the baseline model (lib/model computeDirectBaseline) for a study's
 * measurable question. Pure apart from reading the model's data files, so the
 * app (server/model-adapter.ts) and the demo seed price questions identically.
 */
import { COMPANIES, metricIds, type ModelStore } from "@/lib/model";
import { baselineFor, fundingQuestion, hiringQuestion, trafficQuestion } from "@/lib/model/question-kinds";
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

/**
 * Outcomes the model can price for a startup: weekly package downloads, plus
 * Felix's other question kinds (lib/model/question-kinds.ts) when the company
 * has the matching public source: web traffic rank, open jobs, and new SEC
 * Form D filings. Each resolves from a named public source.
 */
export function modelMetricsFor(store: ModelStore, startup: { slug: string; name: string }): OpeningLineMetric[] {
  const company = companyFor(startup);
  const publicIds = new Set(company ? store.readPoints(company.id).map((p) => p.metricId) : []);
  const downloads: OpeningLineMetric[] = resolvableMetrics(startup).map((metric) => ({
    id: metric.id,
    label: metric.label.replace(/^(npm|PyPI) downloads: /, "Weekly $1 downloads of "),
    unit: metric.unit,
    kind: "weekly_total",
    hasPublicData: publicIds.has(metric.id),
    thresholdLabel: "At least (downloads in the week)",
    dateLabel: "Week ending",
  }));
  if (!company) return downloads;
  const kinds: OpeningLineMetric[] = [
    {
      id: metricIds.trancoRank,
      label: `Web traffic rank of ${company.domain} (7-day average)`,
      unit: "rank",
      kind: "rank_average",
      hasPublicData: publicIds.has(metricIds.trancoRank),
      thresholdLabel: "Rank at or better than (e.g. 5000 = top 5,000)",
      dateLabel: "Week ending",
    },
    ...(company.jobBoard
      ? [
          {
            id: metricIds.openJobs,
            label: "Open job postings on a date",
            unit: "postings",
            kind: "count_on_day" as const,
            hasPublicData: publicIds.has(metricIds.openJobs),
            thresholdLabel: "At least (open postings)",
            dateLabel: "Checked on",
          },
        ]
      : []),
    ...(company.secCik
      ? [
          {
            id: metricIds.formDAmountSold,
            label: "Files a new SEC Form D (signals a fundraise)",
            unit: "filing",
            kind: "event_by_date" as const,
            hasPublicData: publicIds.has(metricIds.formDAmountSold),
            thresholdLabel: null,
            dateLabel: "Filed by",
          },
        ]
      : []),
  ];
  return [...downloads, ...kinds];
}

/** Prices one of Felix's non-download question kinds with his model. */
function estimateQuestionKind(
  store: ModelStore,
  company: NonNullable<ReturnType<typeof companyFor>>,
  link: MetricLink,
  base: ModelEstimate,
  asOf: Date,
): ModelEstimate {
  const opensAt = asOf.toISOString();
  const q =
    link.metricId === metricIds.trancoRank
      ? trafficQuestion(company.id, link.threshold, link.targetDate, opensAt)
      : link.metricId === metricIds.openJobs
        ? hiringQuestion(company.id, link.threshold, link.targetDate, opensAt)
        : fundingQuestion(company.id, link.targetDate, opensAt);
  if (!q) return { ...base, notes: [`${company.name} has no public source for this outcome.`] };
  const wording = {
    question: q.text,
    yesCriteria: q.yesCriteria,
    noCriteria: q.noCriteria,
    resolutionSource: { url: q.resolutionUrl, title: q.resolutionTitle },
  };
  const result = baselineFor(q, store.readPoints(company.id), asOf);
  const shared = {
    ...base,
    ...wording,
    modelVersion: result.method.version,
    inputsHash: result.method.details.inputsHash,
    notes: [...result.notes, ...result.missing],
    inputsUsed: result.inputsUsed.map((i) => ({ ...i })),
  };
  if (result.status !== "ok" || result.probability == null || result.low == null || result.high == null) return shared;
  const probability = clampProbability(result.probability);
  const low = Math.min(clampProbability(result.low), probability);
  const high = Math.max(clampProbability(result.high), probability);
  return {
    ...shared,
    status: "OK",
    probability,
    low,
    high,
    confidence: result.confidence ?? "low",
    methodology: `${result.method.description} Model uncertainty band ${Math.round(low * 100)}–${Math.round(high * 100)}%. As of ${result.asOf}.`.slice(0, 1000),
  };
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
  if (!metric) {
    const kind = company && modelMetricsFor(store, startup).find((m) => m.id === link.metricId && m.kind !== "weekly_total");
    if (kind) return estimateQuestionKind(store, company, link, base, asOf);
    return { ...base, notes: [`No metric "${link.metricId}" with a public resolution source exists for ${startup.name}.`] };
  }

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
