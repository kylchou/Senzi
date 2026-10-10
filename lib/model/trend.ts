// Robust straight-line trend: Theil–Sen slope (median of pairwise slopes),
// median intercept, and a MAD-based residual scale. A single spike moves none
// of these much, unlike least squares.

import { median, robustScale } from './math.js';

export interface TrendFit {
  slope: number;
  intercept: number;
  /** Robust standard deviation of residuals (before any floor). */
  scale: number;
  n: number;
  tMean: number;
  /** Sum of squared deviations of t from its mean. */
  sxx: number;
  residuals: number[];
}

export function theilSen(ts: readonly number[], ys: readonly number[]): { slope: number; intercept: number } {
  if (ts.length !== ys.length) throw new Error('ts and ys must have equal length');
  if (ts.length < 2) throw new Error('Need at least 2 points for a trend');
  const slopes: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    for (let j = i + 1; j < ts.length; j++) {
      const dt = ts[j]! - ts[i]!;
      if (dt !== 0) slopes.push((ys[j]! - ys[i]!) / dt);
    }
  }
  if (slopes.length === 0) throw new Error('All points share the same t');
  const slope = median(slopes);
  const intercept = median(ys.map((y, i) => y - slope * ts[i]!));
  return { slope, intercept };
}

export function fitTrend(ts: readonly number[], ys: readonly number[]): TrendFit {
  const { slope, intercept } = theilSen(ts, ys);
  const residuals = ys.map((y, i) => y - (intercept + slope * ts[i]!));
  const tMean = ts.reduce((s, t) => s + t, 0) / ts.length;
  return {
    slope,
    intercept,
    scale: robustScale(residuals),
    n: ts.length,
    tMean,
    sxx: ts.reduce((s, t) => s + (t - tMean) ** 2, 0),
    residuals,
  };
}

export function predict(fit: Pick<TrendFit, 'slope' | 'intercept'>, t: number): number {
  return fit.intercept + fit.slope * t;
}

/**
 * Leverage term of the usual regression prediction interval: how much less
 * certain a prediction at `t` is than one at the centre of the data.
 */
export function predictionFactor(fit: Pick<TrendFit, 'n' | 'tMean' | 'sxx'>, t: number): number {
  return Math.sqrt(1 + 1 / fit.n + (fit.sxx > 0 ? (t - fit.tMean) ** 2 / fit.sxx : 0));
}
