/**
 * VC-side helpers over estimate data. These do not recompute
 * forecasts, they only compare snapshots already produced,
 * and describe freshness and uncertainty for display and reports.
 *
 * The three measurements are kept distinct everywhere:
 *  - opening baseline (set before forecasting, with methodology)
 *  - community YES credit-allocation share (YES credits / total credits)
 *  - calibrated probability (only when Engineer 2 supplies calibration evidence)
 */
import {
  LOW_PARTICIPATION_THRESHOLD,
  MAX_TREND_POINTS,
  MIN_PARTICIPANTS_FOR_MOVEMENT,
  STALE_ESTIMATE_MS,
} from "./constants";
import type { EstimatePoint, MarketEstimate, Study } from "./types";

export interface BaselineView {
  value: number | null;
  methodology: string | null;
  source: "market" | "study" | null;
}

/** Prefers the baseline recorded on the market; falls back to the study proposal. */
export function resolveBaseline(
  study: Pick<Study, "baselineValue" | "baselineMethodology">,
  estimate: MarketEstimate | null | undefined): BaselineView {
  if (estimate?.openingBaseline) {
    return {
      value: estimate.openingBaseline.value,
      methodology: estimate.openingBaseline.methodology ?? study.baselineMethodology,
      source: "market",
    };
  }
  if (study.baselineValue != null) {
    return { value: study.baselineValue, methodology: study.baselineMethodology, source: "study" };
  }
  return { value: null, methodology: null, source: null };
}

/** Formats a 0..1 share as a percentage string, or an em dash when unavailable. */
export function formatShare(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** Formats a share change in percentage points with an explicit sign. */
export function formatPointChange(delta: number | null | undefined): string {
  if (delta == null || Number.isNaN(delta)) return "—";
  const pts = delta * 100;
  const sign = pts > 0 ? "+" : pts < 0 ? "−" : "±";
  return `${sign}${Math.abs(pts).toFixed(1)} pts`;
}

/** Last point with a defined share at or before `at`. */
function shareAtOrBefore(points: EstimatePoint[], at: number): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.at.getTime() > at) break;
    if (p.yesShare != null) found = p.yesShare;
  }
  return found;
}

export function sortPoints(points: EstimatePoint[]): EstimatePoint[] {
  return [...points].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Change in YES allocation share over a trailing window. Returns null if there
 * is no comparable earlier point (e.g. the market is newer than the window).
 */
export function shareChangeOverWindow(
  points: EstimatePoint[],
  windowMs: number,
  now: Date,
): number | null {
  const sorted = sortPoints(points);
  const latest = shareAtOrBefore(sorted, now.getTime());
  const earlier = shareAtOrBefore(sorted, now.getTime() - windowMs);
  if (latest == null || earlier == null) return null;
  return latest - earlier;
}

/** Change from the first recorded share (or the baseline when no early share exists). */
export function shareChangeSinceOpen(points: EstimatePoint[], baseline: number | null): number | null {
  const sorted = sortPoints(points).filter((p) => p.yesShare != null);
  if (sorted.length === 0) return null;
  const latest = sorted[sorted.length - 1].yesShare as number;
  const first = baseline ?? (sorted[0].yesShare as number);
  return latest - first;
}

export function shareRange(points: EstimatePoint[]): { min: number; max: number } | null {
  const shares = points.map((p) => p.yesShare).filter((v): v is number => v != null);
  if (shares.length === 0) return null;
  return { min: Math.min(...shares), max: Math.max(...shares) };
}

/** Evenly samples a series down to `max` points, always keeping the last point. */
export function downsample<T>(points: T[], max = MAX_TREND_POINTS): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

export interface Freshness {
  asOf: Date | null;
  lastForecastAt: Date | null;
  isStale: boolean;
  description: string;
}

export function describeFreshness(
  estimate: MarketEstimate | null | undefined,
  studyStatus: Study["status"],
  now: Date,
): Freshness {
  if (!estimate) {
    return {
      asOf: null,
      lastForecastAt: null,
      isStale: studyStatus === "OPEN",
      description: studyStatus === "OPEN" ? "Estimate data unavailable" : "Not yet open for forecasting",
    };
  }
  const age = now.getTime() - estimate.asOf.getTime();
  const isStale = studyStatus === "OPEN" && age > STALE_ESTIMATE_MS;
  return {
    asOf: estimate.asOf,
    lastForecastAt: estimate.lastForecastAt,
    isStale,
    description: isStale ? "Estimate may be out of date" : "Up to date",
  };
}

/** Whether participation is large enough for a movement to be meaningful. */
export const hasMeaningfulParticipation = (estimate: MarketEstimate | null | undefined) =>
  !!estimate && estimate.participantCount >= MIN_PARTICIPANTS_FOR_MOVEMENT;

/** Plain-language uncertainty statements for research pages and reports. */
export function describeUncertainty(
  estimate: MarketEstimate | null | undefined,
  points: EstimatePoint[],
  freshness: Freshness,
): string[] {
  const notes: string[] = [];
  if (!estimate) {
    notes.push("No community forecasts are available yet; only the opening baseline can be shown.");
    return notes;
  }
  if (estimate.allocation.totalCredits === 0) {
    notes.push("No credits have been allocated yet, so there is no community allocation share.");
  }
  if (estimate.participantCount < LOW_PARTICIPATION_THRESHOLD) {
    notes.push(
      `Only ${estimate.participantCount} participant${estimate.participantCount === 1 ? "" : "s"} have forecast; the allocation share can move sharply with a single new forecast.`,
    );
  }
  if (!estimate.calibratedProbability) {
    notes.push(
      "No calibrated probability is available: there is not yet enough resolved forecast history to evaluate calibration.",
    );
  } else if (estimate.calibratedProbability.sampleSize < 30) {
    notes.push(
      `The calibrated probability is based on ${estimate.calibratedProbability.sampleSize} resolved markets and should be read with caution.`,
    );
  }
  const range = shareRange(points);
  if (range && range.max - range.min >= 0.3) {
    notes.push(
      `The allocation share has ranged from ${formatShare(range.min)} to ${formatShare(range.max)}, indicating unsettled community views.`,
    );
  }
  if (freshness.isStale) {
    notes.push("The latest estimate is more than 24 hours old.");
  }
  return notes;
}
