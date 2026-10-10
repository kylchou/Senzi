// Backtest: run the model as of past dates using only data available then,
// compare with what happened, and report error and calibration.
//
// Questions are synthetic: thresholds at multiples of the last observed week,
// for windows 1-8 weeks ahead. There are no real past VC questions to use.

import { addDays, fromDayNumber } from './dates';
import { forecastWeekly, probabilityAtLeast, probabilityAtLeastRaw, shrinkWeight } from './forecast';
import { clamp, seedFrom, Z90 } from './math';
import type { ModelParams } from './params';
import { buildDailySeries, weeklySeries, windowTotal } from './series';
import { predictionFactor } from './trend';
import type { DataPoint } from './types';

export interface BacktestConfig {
  horizons: number[];
  multipliers: number[];
  /** Minimum weeks of history before the first as-of date. */
  minHistoryWeeks: number;
  /** Days between as-of dates. */
  stepDays: number;
}

export const defaultBacktestConfig: BacktestConfig = {
  horizons: [1, 2, 4, 8],
  multipliers: [0.8, 0.9, 1, 1.1, 1.25, 1.5],
  minHistoryWeeks: 8,
  stepDays: 7,
};

/** Everything needed to recompute a case's probability under different sigma settings. */
export interface BacktestCase {
  metricId: string;
  companyId: string;
  /** Last day of data available at the as-of time. */
  dataThrough: string;
  horizon: number;
  windowEnd: string;
  multiplier: number;
  threshold: number;
  lastWeekTotal: number;
  actual: number;
  outcome: 0 | 1;
  weeksUsed: number;
  effectiveHorizon: number;
  /** Fitted line at the last used week, and the last used week itself (log scale; the line if that week is a spike). */
  levelLine: number;
  levelLast: number;
  /** The last used week as observed, with no spike guard (persistence comparator). */
  levelLastRaw: number;
  slope: number;
  scale: number;
  leverage: number;
}

/** Fits once per (series, as-of, horizon) and expands to one case per threshold multiplier. */
export function buildCases(points: readonly DataPoint[], metricId: string, params: ModelParams, cfg: BacktestConfig = defaultBacktestConfig): BacktestCase[] {
  const full = buildDailySeries(points, metricId, new Date('9999-01-01T00:00:00Z'));
  if (full.firstDay === null || full.lastDay === null) return [];
  const companyId = points.find((p) => p.metricId === metricId)!.companyId;
  const noBoot: ModelParams = { ...params, bootstrapReplicates: 0 };
  const cases: BacktestCase[] = [];

  for (let L = full.firstDay + cfg.minHistoryWeeks * 7 - 1; L <= full.lastDay - 7; L += cfg.stepDays) {
    const dataThrough = fromDayNumber(L);
    // Point in time: what was published by the end of the day after L.
    const asOf = new Date(`${addDays(dataThrough, 2)}T00:00:00Z`);
    const series = buildDailySeries(points, metricId, asOf);
    if (series.lastDay === null) continue;
    for (const h of cfg.horizons) {
      const windowEnd = L + 7 * h;
      if (windowEnd > full.lastDay) continue;
      const actual = windowTotal(full, windowEnd);
      if (actual === null) continue;
      const weekly = weeklySeries(series, fromDayNumber(windowEnd), params.fitWeeks);
      const fc = forecastWeekly(weekly, noBoot, 0);
      if (fc.status !== 'ok' || !fc.fit) continue;
      const last = fc.used[fc.used.length - 1]!;
      // Thresholds are relative to the most recent complete week before the as-of date.
      for (const m of cfg.multipliers) {
        const threshold = Math.round(last.total * m);
        cases.push({
          metricId,
          companyId,
          dataThrough,
          horizon: h,
          windowEnd: fromDayNumber(windowEnd),
          multiplier: m,
          threshold,
          lastWeekTotal: last.total,
          actual,
          outcome: actual >= threshold ? 1 : 0,
          weeksUsed: fc.used.length,
          effectiveHorizon: fc.horizonWeeks,
          levelLine: fc.fit.intercept + fc.fit.slope * last.t,
          levelLast: fc.spikes.includes(last.windowEnd) ? fc.fit.intercept + fc.fit.slope * last.t : Math.log1p(last.total),
          levelLastRaw: Math.log1p(last.total),
          slope: fc.fit.slope,
          scale: fc.fit.scale,
          leverage: predictionFactor(fc.fit, 0),
        });
      }
    }
  }
  return cases;
}

/** The settings the backtest tunes. */
export interface TunedSettings {
  sigmaScale: number;
  driftPerWeek: number;
  /** 'lastRaw' (no spike guard) exists only for the persistence comparator. */
  levelAnchor: 'line' | 'last' | 'lastRaw';
  trendDamping: number;
  tailShrink: number;
}

/** "Last week carried forward", exactly as observed: no trend, no spike guard. */
export const PERSISTENCE: Pick<TunedSettings, 'levelAnchor' | 'trendDamping' | 'tailShrink'> = {
  levelAnchor: 'lastRaw',
  trendDamping: 0,
  tailShrink: 0,
};

export function caseMu(c: BacktestCase, s: Pick<TunedSettings, 'levelAnchor' | 'trendDamping'>): number {
  const level = s.levelAnchor === 'last' ? c.levelLast : s.levelAnchor === 'lastRaw' ? c.levelLastRaw : c.levelLine;
  return level + s.trendDamping * c.slope * c.effectiveHorizon;
}

export function caseSigma(c: BacktestCase, s: Pick<TunedSettings, 'sigmaScale' | 'driftPerWeek'>, params: ModelParams): number {
  return Math.sqrt((s.sigmaScale * Math.max(c.scale, params.scaleFloor) * c.leverage) ** 2 + s.driftPerWeek ** 2 * c.effectiveHorizon);
}

/** Probability for a case under the given settings, including both kinds of shrinkage. */
export function caseProbability(c: BacktestCase, s: TunedSettings, params: ModelParams): number {
  const raw = probabilityAtLeastRaw(caseMu(c, s), caseSigma(c, s, params), c.threshold);
  const w = (shrinkWeight(c.weeksUsed, params) ?? 0) * (1 - s.tailShrink);
  return w * raw + (1 - w) * 0.5;
}

export interface Scores {
  n: number;
  brier: number;
  logLoss: number;
  baseRate: number;
}

const EPS = 1e-4;

export function score(ps: readonly number[], ys: readonly (0 | 1)[]): Scores {
  const n = ps.length;
  let brier = 0;
  let ll = 0;
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const p = clamp(ps[i]!, EPS, 1 - EPS);
    const y = ys[i]!;
    brier += (p - y) ** 2;
    ll += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    pos += y;
  }
  return { n, brier: brier / n, logLoss: ll / n, baseRate: pos / n };
}

export const SIGMA_SCALE_GRID = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
export const DRIFT_GRID = [0, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15];
export const DAMPING_GRID = [0, 0.25, 0.5, 0.75, 1];
export const TAIL_SHRINK_GRID = [0, 0.05, 0.1];

/**
 * Grid search for the settings with the lowest log loss on the given cases.
 * `fixed` pins some settings (e.g. PERSISTENCE) and searches the rest.
 */
export function tuneSettings(
  cases: readonly BacktestCase[],
  params: ModelParams,
  fixed: Partial<TunedSettings> = {},
): TunedSettings & { logLoss: number } {
  const ys = cases.map((c) => c.outcome);
  const anchors = fixed.levelAnchor ? [fixed.levelAnchor] : (['line', 'last'] as const);
  const dampings = fixed.trendDamping !== undefined ? [fixed.trendDamping] : DAMPING_GRID;
  const tails = fixed.tailShrink !== undefined ? [fixed.tailShrink] : TAIL_SHRINK_GRID;
  let best: TunedSettings & { logLoss: number } = { ...defaultTuned, logLoss: Infinity };
  for (const levelAnchor of anchors)
    for (const trendDamping of dampings)
      for (const tailShrink of tails)
        for (const sigmaScale of SIGMA_SCALE_GRID)
          for (const driftPerWeek of DRIFT_GRID) {
            const s: TunedSettings = { sigmaScale, driftPerWeek, levelAnchor, trendDamping, tailShrink };
            const { logLoss } = score(cases.map((c) => caseProbability(c, s, params)), ys);
            if (logLoss < best.logLoss) best = { ...s, logLoss };
          }
  return best;
}

/**
 * Picks the spread used for the displayed 80% forecast range so that actual
 * totals land inside it about 80% of the time at every horizon. Display only:
 * probabilities use the settings from tuneSettings.
 */
export function tuneRangeSigma(
  cases: readonly BacktestCase[],
  settings: TunedSettings,
  params: ModelParams,
): { rangeSigmaScale: number; rangeDriftPerWeek: number; worstGap: number } {
  const horizons = [...new Set(cases.map((c) => c.horizon))];
  let best = { rangeSigmaScale: 1, rangeDriftPerWeek: 0, worstGap: Infinity, sq: Infinity };
  for (const sigmaScale of SIGMA_SCALE_GRID)
    for (const driftPerWeek of [...DRIFT_GRID, 0.2, 0.25]) {
      const gaps = horizons.map((h) => rangeCoverage(cases.filter((c) => c.horizon === h), { ...settings, sigmaScale, driftPerWeek }, params) - 0.8);
      const sq = gaps.reduce((a, g) => a + g * g, 0);
      if (sq < best.sq) best = { rangeSigmaScale: sigmaScale, rangeDriftPerWeek: driftPerWeek, worstGap: Math.max(...gaps.map(Math.abs)), sq };
    }
  return { rangeSigmaScale: best.rangeSigmaScale, rangeDriftPerWeek: best.rangeDriftPerWeek, worstGap: best.worstGap };
}

const defaultTuned: TunedSettings = { sigmaScale: 1, driftPerWeek: 0, levelAnchor: 'line', trendDamping: 1, tailShrink: 0 };

export interface CalibrationBin {
  lower: number;
  upper: number;
  n: number;
  meanPredicted: number | null;
  observed: number | null;
}

export function calibrationTable(ps: readonly number[], ys: readonly (0 | 1)[], bins = 10): CalibrationBin[] {
  const out = Array.from({ length: bins }, (_, i) => ({ lower: i / bins, upper: (i + 1) / bins, n: 0, sp: 0, sy: 0 }));
  ps.forEach((p, i) => {
    const b = out[Math.min(bins - 1, Math.floor(p * bins))]!;
    b.n++;
    b.sp += p;
    b.sy += ys[i]!;
  });
  return out.map((b) => ({ lower: b.lower, upper: b.upper, n: b.n, meanPredicted: b.n ? b.sp / b.n : null, observed: b.n ? b.sy / b.n : null }));
}

export function expectedCalibrationError(bins: readonly CalibrationBin[]): number {
  const total = bins.reduce((s, b) => s + b.n, 0);
  return bins.reduce((s, b) => (b.n ? s + (b.n / total) * Math.abs(b.meanPredicted! - b.observed!) : s), 0);
}

/** Share of actual 7-day totals inside the model's 80% forecast range. Should be near 0.8. */
export function rangeCoverage(cases: readonly BacktestCase[], s: TunedSettings, params: ModelParams): number {
  const fits = uniqueFits(cases);
  let inside = 0;
  for (const c of fits) {
    const sigma = caseSigma(c, s, params);
    const mu = caseMu(c, s);
    const lo = Math.expm1(mu - Z90 * sigma);
    const hi = Math.expm1(mu + Z90 * sigma);
    if (c.actual >= lo && c.actual <= hi) inside++;
  }
  return fits.length ? inside / fits.length : Number.NaN;
}

/** One case per fit (drops the threshold dimension). */
export function uniqueFits(cases: readonly BacktestCase[]): BacktestCase[] {
  const seen = new Set<string>();
  return cases.filter((c) => {
    const k = `${c.metricId}|${c.dataThrough}|${c.horizon}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Median absolute percentage error of the median forecast vs the actual total. */
export function medianApe(cases: readonly BacktestCase[], s: Pick<TunedSettings, 'levelAnchor' | 'trendDamping'>): number {
  const errs = uniqueFits(cases)
    .map((c) => Math.abs(Math.expm1(caseMu(c, s)) / c.actual - 1))
    .sort((a, b) => a - b);
  return errs.length ? errs[Math.floor(errs.length / 2)]! : Number.NaN;
}

/** Average width of the model-uncertainty band, recomputed with the bootstrap for a sample of cases. */
export function averageBandWidth(
  points: readonly DataPoint[],
  cases: readonly BacktestCase[],
  params: ModelParams,
  sample = 300,
): number {
  const step = Math.max(1, Math.floor(cases.length / sample));
  let width = 0;
  let n = 0;
  for (let i = 0; i < cases.length; i += step) {
    const c = cases[i]!;
    const series = buildDailySeries(points, c.metricId, new Date(`${addDays(c.dataThrough, 2)}T00:00:00Z`));
    const fc = forecastWeekly(weeklySeries(series, c.windowEnd, params.fitWeeks), params, seedFrom(c.metricId, c.dataThrough, String(c.horizon)));
    if (fc.status !== 'ok') continue;
    const r = probabilityAtLeast(fc, c.threshold, params);
    width += r.high - r.low;
    n++;
  }
  return n ? width / n : Number.NaN;
}

