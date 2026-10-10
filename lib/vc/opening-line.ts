/**
 * Pure helpers for the model-set opening line: wording a linked question,
 * rating the model's confidence, and keeping the firm's private figures out
 * of anything other firms or the public can see.
 */
import type { CreateMarketForStudyInput } from "./ports";
import type { ModelConfidence, ModelEstimate } from "./types";

export const OPENING_LINE_MODEL_NAME = "senzi-direct-metric";

/** The pricing engine needs a price strictly inside (0, 1); the market schema allows 1%–99%. */
export function clampProbability(p: number): number {
  return Math.min(0.99, Math.max(0.01, p));
}

/**
 * How much to trust the estimate. "low" makes the market's starting liquidity
 * smaller, so early forecasts move the price more.
 */
export function confidenceFor(input: { low: number; high: number; limitedHistory: boolean; usesFirmData: boolean }): ModelConfidence {
  const band = input.high - input.low;
  if (band > 0.5 || input.limitedHistory) return "low";
  if (band <= 0.25 && !input.usesFirmData) return "high";
  return "medium";
}

const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** YES/NO criteria that match exactly what the model priced. */
export function criteriaFor(input: {
  startupName: string;
  metricLabel: string;
  unit: string;
  kind: "snapshot" | "weekly_total";
  threshold: number;
  targetDate: string;
  resolutionUrl: string | null;
}): { yesCriteria: string; noCriteria: string } {
  const amount = `${input.threshold.toLocaleString("en-US", { maximumFractionDigits: 20 })} ${input.unit}`;
  const what = `${input.startupName}'s ${input.metricLabel}`;
  const period = input.kind === "snapshot" ? `as of ${fmtDay(input.targetDate)}` : `for the 7 days ending ${fmtDay(input.targetDate)} (UTC)`;
  const evidence = input.resolutionUrl
    ? `as reported by the public source (${input.resolutionUrl})`
    : "as shown by public evidence, such as a company announcement or filing, that VentureCast verifies at resolution. Figures the proposing firm entered don't count as evidence";
  return {
    yesCriteria: `${what} ${period} is at least ${amount}, ${evidence}.`,
    noCriteria: `${what} ${period} is below ${amount}, or no qualifying evidence of at least ${amount} exists.`,
  };
}

/**
 * The inputs list with the firm's figures removed, for tables other firms or
 * the public can read. Public (scraped) values are kept.
 */
export function publicInputs(inputsUsed: Record<string, unknown>[]): Record<string, unknown>[] {
  return inputsUsed.map((p) => {
    const firm = p.provenance !== "scraped";
    return {
      metricId: p.metricId,
      source: p.source,
      provenance: p.provenance,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      simulated: p.simulated,
      ...(firm ? {} : { value: p.value, sourceUrl: p.sourceUrl }),
    };
  });
}

/** Short note shown with the model line, e.g. "npm downloads: stripe + firm-provided history". */
export function inputsNoteFor(estimate: ModelEstimate, metricLabel: string): string {
  const usesFirm = estimate.inputsUsed.some((p) => p.provenance !== "scraped");
  const usesPublic = estimate.inputsUsed.some((p) => p.provenance === "scraped");
  return [usesPublic ? `${metricLabel} (public data)` : null, usesFirm ? "firm-provided history" : null].filter(Boolean).join(" + ");
}

/** The market-creation payload's model block, from an OK estimate. */
export function marketModelInput(estimate: ModelEstimate, metricLabel: string): CreateMarketForStudyInput["model"] {
  if (estimate.status !== "OK" || estimate.probability == null || estimate.low == null || estimate.high == null || !estimate.inputsHash) {
    throw new Error("Only an OK estimate can open a market");
  }
  return {
    low: estimate.low,
    high: estimate.high,
    confidence: estimate.confidence ?? "low",
    asOf: estimate.asOf,
    modelName: estimate.modelName,
    modelVersion: estimate.modelVersion,
    inputsHash: estimate.inputsHash,
    inputsNote: inputsNoteFor(estimate, metricLabel),
    inputsUsed: publicInputs(estimate.inputsUsed),
    notes: estimate.notes,
  };
}
