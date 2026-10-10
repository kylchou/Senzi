/**
 * Pure helpers for VC startup comparisons. Scoring uses the forecasting
 * engine's own statistics (brierScore, wilsonInterval) so comparisons and
 * performance analytics agree.
 */
import { brierScore, wilsonInterval } from "@/lib/forecasting/stats";
import type { CompareQuestion, MarketEstimate, TrackRecord } from "./types";

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;
/** Below this many decided questions, scores are shown with a strong caveat. */
export const SMALL_SAMPLE = 10;

export const COMPARISON_LIMITATIONS = [
  "Questions differ between startups, so counts and scores are not like-for-like measures of company quality.",
  "The general LMSR price comes from all trades and is not a calibrated probability.",
  "Indicators are public, scraped signals (downloads, repositories, hiring, filings). They are not revenue, customers, or valuation.",
  "Not investment advice.",
];

export function toCompareQuestion(
  market: { id: string; slug?: string; question: string; status: CompareQuestion["status"]; closesAt: Date | null },
  estimate: MarketEstimate | undefined,
  study: { id: string } | null,
  change7d: number | null,
): CompareQuestion {
  return {
    marketId: market.id,
    question: market.question,
    kind: study ? "study" : "market",
    studyId: study?.id ?? null,
    href: study ? `/vc/studies/${study.id}` : market.slug ? `/markets/${market.slug}` : null,
    status: estimate?.status ?? market.status,
    closesAt: market.closesAt,
    openingBaseline: estimate?.openingBaseline?.value ?? null,
    allocationShare: estimate?.generalPrice ?? null,
    calibratedProbability: estimate?.calibratedProbability?.value ?? null,
    forecasters: estimate?.participantCount ?? 0,
    forecastCount: estimate?.forecastCount ?? 0,
    change7d,
    outcome: estimate?.resolution?.outcome ?? null,
  };
}

/** Track record over resolved questions. VOID outcomes are excluded from rates and scores. */
export function computeTrackRecord(resolved: CompareQuestion[]): TrackRecord {
  const decided = resolved.filter((q) => q.outcome === "YES" || q.outcome === "NO");
  const yes = decided.filter((q) => q.outcome === "YES").length;
  const actual = (q: CompareQuestion): 0 | 1 => (q.outcome === "YES" ? 1 : 0);
  const baselinePairs = decided
    .filter((q) => q.openingBaseline != null)
    .map((q) => ({ predicted: q.openingBaseline as number, actual: actual(q) }));
  const sharePairs = decided
    .filter((q) => q.allocationShare != null)
    .map((q) => ({ predicted: q.allocationShare as number, actual: actual(q) }));

  const limitations: string[] = [];
  if (decided.length === 0) {
    limitations.push("No resolved questions yet, so there is no track record.");
  } else if (decided.length < SMALL_SAMPLE) {
    limitations.push(
      `Based on ${decided.length} resolved question${decided.length === 1 ? "" : "s"}; scores can change a lot with each new resolution.`,
    );
  }
  const voided = resolved.length - decided.length;
  if (voided > 0) limitations.push(`${voided} voided question${voided === 1 ? " is" : "s are"} excluded from rates and scores.`);

  return {
    decided: decided.length,
    yes,
    voided,
    yesRate: decided.length ? yes / decided.length : null,
    yesRateInterval: wilsonInterval(yes, decided.length),
    baselineBrier: brierScore(baselinePairs),
    allocationShareBrier: brierScore(sharePairs),
    limitations,
  };
}

/** Parses "a,b,c" into unique ids, keeping order. */
export function parseCompareIds(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(",") : raw ?? "";
  return [...new Set(joined.split(",").map((s) => s.trim()).filter(Boolean))];
}
