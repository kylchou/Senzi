// Fit + forecast + probability for one weekly series.
//
// Model, in log space with y = ln(1 + weekly total):
//   trend:   y_t = a + b t + noise          (Theil–Sen fit over the last N weeks)
//   target:  mu = level + phi * b * h        (the question window is t = 0)
//            level = fitted line or last observed week at the last used week,
//            phi = trend damping, h = weeks from that week to the target
//   spread:  sigma^2 = (c * s * L)^2 + d^2 * h
//            s = robust residual scale (floored), L = prediction leverage factor,
//            h = weeks from the last observed week to the target,
//            c, d = sigmaScale, driftPerWeek (set from the backtest)
//   p_raw = 1 - Phi((ln(1 + T) - mu) / sigma)
// Shrinkage: W = w(n) * (1 - tailShrink), where w(n) < 1 only for thin data
// (n < fullWeightWeeks). p = W p_raw + (1 - W) 0.5, band pulled toward the
// uninformative band by the same weight.
// Band: 10th-90th percentile of p_raw over a residual bootstrap (refit on
// fitted + resampled residuals; an anchored forecast keeps the observed last
// week), widened if needed to include p_raw.

import { clamp, median, normalCdf, quantile, robustScale, seededRandom, Z90 } from './math';
import type { ModelParams } from './params';
import type { WeeklyPoint, WeeklySeries } from './series';
import { fitTrend, predict, predictionFactor, theilSen, type TrendFit } from './trend';

export interface WeeklyForecast {
  status: 'ok' | 'insufficient_data';
  /** Weeks from the last week actually used in the fit to the question window. */
  horizonWeeks: number;
  /** Weeks with a total, used in the fit. */
  used: Array<{ t: number; windowEnd: string; total: number }>;
  missingWeeks: string[];
  spikes: string[];
  /** A detected level shift; `applied` is false when too few weeks follow it to refit. */
  levelShift: { firstWeekAfter: string; change: number; applied: boolean } | null;
  /** Where the forecast started. 'line' when the latest week was unusual even if params say 'last'. */
  anchorUsed: 'line' | 'last' | null;
  fit: TrendFit | null;
  mu: number | null;
  sigma: number | null;
  boot: Array<{ mu: number; sigma: number }>;
  shrinkWeight: number | null;
  seed: number;
}

/**
 * Finds a persistent level shift: a week-to-week jump larger than `threshold`
 * (log units) where the median level after it also differs from the median
 * before it by more than `threshold`. Returns the index of the first week after
 * the shift, choosing the largest qualifying shift, or null.
 */
export function findLevelShift(ys: readonly number[], threshold: number): number | null {
  let best: { i: number; size: number } | null = null;
  for (let i = 1; i < ys.length; i++) {
    const jump = ys[i]! - ys[i - 1]!;
    if (Math.abs(jump) <= threshold) continue;
    const before = median(ys.slice(0, i));
    const after = median(ys.slice(i));
    const size = Math.abs(after - before);
    if (size > threshold && Math.sign(after - before) === Math.sign(jump) && (!best || size > best.size)) best = { i, size };
  }
  return best?.i ?? null;
}

export function shrinkWeight(n: number, p: ModelParams): number | null {
  if (n < p.minWeeks) return null;
  if (n >= p.fullWeightWeeks) return 1;
  return p.minShrinkWeight + ((1 - p.minShrinkWeight) * (n - p.minWeeks)) / (p.fullWeightWeeks - p.minWeeks);
}

export function forecastSigma(scale: number, fit: Pick<TrendFit, 'n' | 'tMean' | 'sxx'>, horizonWeeks: number, p: ModelParams): number {
  const s = Math.max(Number.isFinite(scale) ? scale : 0, p.scaleFloor);
  const fromFit = p.sigmaScale * s * predictionFactor(fit, 0);
  return Math.sqrt(fromFit ** 2 + p.driftPerWeek ** 2 * horizonWeeks);
}

export function forecastWeekly(
  weekly: WeeklySeries,
  params: ModelParams,
  seed: number,
  extraTotals: ReadonlyMap<string, number> = new Map(),
): WeeklyForecast {
  let used: WeeklyForecast['used'] = [];
  const missingWeeks: string[] = [];
  for (const w of weekly.weeks) {
    const total = w.total ?? extraTotals.get(w.windowEnd) ?? null;
    if (total === null) missingWeeks.push(w.windowEnd);
    else used.push({ t: w.t, windowEnd: w.windowEnd, total });
  }

  // After a persistent level shift, only the weeks since the shift describe the current level and trend.
  let levelShift: WeeklyForecast['levelShift'] = null;
  if (params.levelShiftThreshold !== null && used.length > params.minWeeks) {
    const i = findLevelShift(used.map((u) => Math.log1p(u.total)), params.levelShiftThreshold);
    if (i !== null) {
      const after = used.length - i;
      levelShift = { firstWeekAfter: used[i]!.windowEnd, change: used[i]!.total / used[i - 1]!.total - 1, applied: after >= params.minWeeks };
      if (levelShift.applied) used = used.slice(i);
    }
  }

  // If the newest weeks are incomplete, the effective forecast horizon is longer.
  const horizonWeeks = used.length ? -used[used.length - 1]!.t : weekly.horizonWeeks;
  const base: WeeklyForecast = {
    status: 'insufficient_data',
    horizonWeeks,
    used,
    missingWeeks,
    spikes: [],
    levelShift,
    anchorUsed: null,
    fit: null,
    mu: null,
    sigma: null,
    boot: [],
    shrinkWeight: null,
    seed,
  };
  const w = shrinkWeight(used.length, params);
  if (w === null) return base;

  const ts = used.map((u) => u.t);
  const ys = used.map((u) => Math.log1p(u.total));
  const fit = fitTrend(ts, ys);
  const tLast = ts[ts.length - 1]!;
  const spikeCut = params.spikeThreshold * Math.max(fit.scale, params.scaleFloor);
  const spikes = used.filter((_, i) => Math.abs(fit.residuals[i]!) > spikeCut).map((u) => u.windowEnd);
  // Never start the forecast from an unusual latest week.
  const lastIsSpike = Math.abs(fit.residuals[fit.residuals.length - 1]!) > spikeCut;
  const anchorUsed = params.levelAnchor === 'last' && !lastIsSpike ? 'last' : 'line';
  const muFrom = (slope: number, intercept: number, yLast: number) =>
    (anchorUsed === 'last' ? yLast : intercept + slope * tLast) + params.trendDamping * slope * horizonWeeks;
  const mu = muFrom(fit.slope, fit.intercept, ys[ys.length - 1]!);
  const sigma = forecastSigma(fit.scale, fit, horizonWeeks, params);

  const rand = seededRandom(seed);
  const fitted = ts.map((t) => predict(fit, t));
  const boot: WeeklyForecast['boot'] = [];
  for (let b = 0; b < params.bootstrapReplicates; b++) {
    const yStar = fitted.map((f) => f + fit.residuals[Math.floor(rand() * fit.residuals.length)]!);
    const refit = theilSen(ts, yStar);
    const resid = yStar.map((y, i) => y - predict(refit, ts[i]!));
    // The last observed week is a known fact, so an anchored forecast keeps it; only the trend varies.
    boot.push({ mu: muFrom(refit.slope, refit.intercept, ys[ys.length - 1]!), sigma: forecastSigma(robustScale(resid), fit, horizonWeeks, params) });
  }

  return { ...base, status: 'ok', fit, mu, sigma, boot, spikes, anchorUsed, shrinkWeight: w };
}

export function probabilityAtLeastRaw(mu: number, sigma: number, threshold: number): number {
  if (threshold <= 0) return 1;
  return clamp(1 - normalCdf((Math.log1p(threshold) - mu) / sigma), 0, 1);
}

export interface ProbabilityResult {
  rawProbability: number;
  probability: number;
  low: number;
  high: number;
}

export function probabilityAtLeast(fc: WeeklyForecast, threshold: number, params: ModelParams): ProbabilityResult {
  if (fc.status !== 'ok' || fc.mu === null || fc.sigma === null || fc.shrinkWeight === null) {
    throw new Error('Forecast has no fit');
  }
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error('Threshold must be a non-negative number');
  // "At least 0" is certain by definition, not a forecast; no shrinkage applies.
  if (threshold === 0) return { rawProbability: 1, probability: 1, low: 1, high: 1 };
  const pRaw = probabilityAtLeastRaw(fc.mu, fc.sigma, threshold);
  let lowRaw = pRaw;
  let highRaw = pRaw;
  if (fc.boot.length) {
    const ps = fc.boot.map((b) => probabilityAtLeastRaw(b.mu, b.sigma, threshold));
    lowRaw = Math.min(quantile(ps, params.bandQuantiles[0]), pRaw);
    highRaw = Math.max(quantile(ps, params.bandQuantiles[1]), pRaw);
  }
  const w = fc.shrinkWeight * (1 - params.tailShrink);
  const [u0, u1] = params.uninformativeBand;
  return {
    rawProbability: pRaw,
    probability: w * pRaw + (1 - w) * 0.5,
    low: w * lowRaw + (1 - w) * u0,
    high: w * highRaw + (1 - w) * u1,
  };
}

/** Median and 80% range of the 7-day total implied by mu and sigma. */
export function forecastTotals(mu: number, sigma: number): { median: number; range80: [number, number] } {
  return {
    median: Math.expm1(mu),
    range80: [Math.max(0, Math.expm1(mu - Z90 * sigma)), Math.expm1(mu + Z90 * sigma)],
  };
}

export type { WeeklyPoint };
