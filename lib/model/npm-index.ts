// npm-wide index: separates npm-wide changes from a company's own growth.
//
// npm download counts move together when npm changes how it counts or when
// automated traffic (CI, mirrors, agents) grows across the ecosystem. In
// Aug–Sep 2026 every large package jumped 25–40% at once. Fitting a company's
// raw downloads reads that as company growth and projects it forward.
//
// The index is the equal-weighted mean of log 7-day totals over a basket of
// large, unrelated packages (catalog.NPM_INDEX_PACKAGES). For an npm question:
//
//   ln(total_0) = share_0 + index_0
//   share_w     = ln(company over days D) − mean_k ln(package k over days D)
//
// D is the days in week w where the company and every basket package have a
// count. Outage days hit all of npm at once, so a week with a few missing days
// still gets a share (same days on both sides), recovering weeks the raw model
// drops. The company's trend is fitted on "adjusted" totals: its downloads
// re-expressed at the reference week's npm level, exp(share_w + index_ref).
// The index's move from the reference week to the question window is a
// separate term: mean = damped recent index trend, spread = how much the index
// has moved over the same number of weeks in the last two years. npm-wide moves
// become uncertainty, not company growth.

import { metricIds, NPM_INDEX_PACKAGES } from './catalog';
import { fromDayNumber, toDayNumber } from './dates';
import type { WeeklyForecast } from './forecast';
import type { NpmIndexParams } from './params';
import { buildDailySeries, windowTotal, type DailySeries, type WeeklySeries } from './series';
import { theilSen } from './trend';
import type { DataPoint } from './types';

export const NPM_INDEX_METRIC = 'npm_index';

export interface NpmBasket {
  packages: DailySeries[];
  /** endDay -> index level (mean log 7-day total), null when any package is missing a day. */
  levelCache: Map<number, number | null>;
}

/** Point-in-time basket: only counts published by `asOf`. */
export function buildBasket(indexPoints: readonly DataPoint[], asOf: Date): NpmBasket {
  const byMetric = new Map<string, DataPoint[]>();
  for (const p of indexPoints) {
    const list = byMetric.get(p.metricId);
    if (list) list.push(p);
    else byMetric.set(p.metricId, [p]);
  }
  const packages = NPM_INDEX_PACKAGES.map((pkg) => {
    const id = metricIds.npm(pkg);
    return buildDailySeries(byMetric.get(id) ?? [], id, asOf);
  }).filter((s) => s.lastDay !== null);
  return { packages, levelCache: new Map() };
}

/** Mean log 7-day total across the basket for the week ending `endDay`. */
export function indexLevel(basket: NpmBasket, endDay: number): number | null {
  const cached = basket.levelCache.get(endDay);
  if (cached !== undefined) return cached;
  let sum = 0;
  let level: number | null = basket.packages.length ? 0 : null;
  for (const s of basket.packages) {
    const total = windowTotal(s, endDay);
    if (total === null || total <= 0) {
      level = null;
      break;
    }
    sum += Math.log(total);
  }
  if (level !== null) level = sum / basket.packages.length;
  basket.levelCache.set(endDay, level);
  return level;
}

/**
 * Company's log 7-day total minus beta × the index level, over the usable days
 * of the week ending `endDay`. Partial weeks are scaled to 7 days on both sides,
 * which cancels exactly when beta is 1.
 */
export function logShare(company: DailySeries, basket: NpmBasket, endDay: number, minDays: number, beta = 1): number | null {
  if (!basket.packages.length) return null;
  const days: number[] = [];
  for (let d = endDay - 6; d <= endDay; d++) {
    const c = company.values.get(d);
    if (c === undefined || c <= 0) continue;
    if (basket.packages.every((s) => (s.values.get(d) ?? 0) > 0)) days.push(d);
  }
  if (days.length < minDays) return null;
  const logWeek = (s: DailySeries) => Math.log((days.reduce((a, d) => a + s.values.get(d)!, 0) * 7) / days.length);
  const mean = basket.packages.reduce((a, s) => a + logWeek(s), 0) / basket.packages.length;
  return logWeek(company) - beta * mean;
}

/**
 * How strongly the company's weekly downloads move with the index: OLS slope
 * of week-to-week log changes on the index's over the `weeks` weeks to
 * `endDay`, holiday weeks excluded, clamped to [0, 1.5]. 1 with fewer than 12 pairs.
 */
export function estimateBeta(company: DailySeries, basket: NpmBasket, endDay: number, weeks: number): { beta: number; pairs: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  let prev: { c: number; i: number } | null = null;
  for (let k = weeks; k >= 0; k--) {
    const end = endDay - 7 * k;
    const c = windowTotal(company, end);
    const i = indexLevel(basket, end);
    const cur = c !== null && c > 0 && i !== null && !isHolidayWeek(end) ? { c: Math.log(c), i } : null;
    if (cur && prev) {
      xs.push(cur.i - prev.i);
      ys.push(cur.c - prev.c);
    }
    prev = cur;
  }
  if (xs.length < 12) return { beta: 1, pairs: xs.length };
  const mx = xs.reduce((a, x) => a + x, 0) / xs.length;
  const my = ys.reduce((a, y) => a + y, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let j = 0; j < xs.length; j++) {
    sxy += (xs[j]! - mx) * (ys[j]! - my);
    sxx += (xs[j]! - mx) ** 2;
  }
  return { beta: sxx > 0 ? Math.min(1.5, Math.max(0, sxy / sxx)) : 1, pairs: xs.length };
}

export interface IndexAdjusted {
  /** Company downloads at the reference week's npm level. Same alignment as the raw weekly series. */
  weekly: WeeklySeries;
  /** Latest week in the fit window with a complete index. */
  reference: { t: number; windowEnd: string; level: number };
  /** t -> index level, for weeks in the fit window with a complete index. */
  levels: Map<number, number>;
  /** Weeks missing from the raw series that got a value relative to npm. */
  recoveredWeeks: string[];
  /** How strongly the company moves with the index (1 = one for one). */
  beta: number;
}

export function adjustWeekly(
  company: DailySeries,
  basket: NpmBasket,
  weekly: WeeklySeries,
  minDays: number,
  betaWeeks: number | null = null,
): IndexAdjusted | null {
  const levels = new Map<number, number>();
  let reference: IndexAdjusted['reference'] | null = null;
  for (const w of weekly.weeks) {
    const level = indexLevel(basket, toDayNumber(w.windowEnd));
    if (level === null) continue;
    levels.set(w.t, level);
    if (!reference || w.t > reference.t) reference = { t: w.t, windowEnd: w.windowEnd, level };
  }
  if (!reference) return null;
  const beta = betaWeeks === null ? 1 : estimateBeta(company, basket, toDayNumber(reference.windowEnd), betaWeeks).beta;
  const recoveredWeeks: string[] = [];
  const weeks = weekly.weeks.map((w) => {
    const share = logShare(company, basket, toDayNumber(w.windowEnd), minDays, beta);
    if (share === null) return { ...w, total: null };
    if (w.total === null) recoveredWeeks.push(w.windowEnd);
    return { ...w, total: Math.exp(share + beta * reference!.level) };
  });
  return { weekly: { weeks, horizonWeeks: weekly.horizonWeeks }, reference, levels, recoveredWeeks, beta };
}

export interface IndexOutlook {
  /** Weeks from the reference week to the question window. */
  horizonWeeks: number;
  /** Theil–Sen trend of the index over the fit window (log per week). Null with too few weeks. */
  slope: number | null;
  /** Standard deviation of past index changes over `horizonWeeks` weeks (log). */
  sd: number;
  /** Index change to the reference week from about 4 and 12 weeks before it (nearest earlier week with data). */
  moves: Array<{ since: string; change: number }>;
}

/** True when any day of the week ending `endDay` falls in the Dec 20 – Jan 10 holiday dip. */
export function isHolidayWeek(endDay: number): boolean {
  for (let d = endDay - 6; d <= endDay; d++) {
    const md = fromDayNumber(d).slice(5);
    if (md >= '12-20' || md <= '01-10') return true;
  }
  return false;
}

/**
 * How far the index may move between the reference week and the question
 * window, from its own history. npm dips sharply over the year-end holidays;
 * past spans that touch them are left out unless the question's own span does.
 */
export function indexOutlook(
  basket: NpmBasket,
  targetEnd: string,
  referenceT: number,
  p: Pick<NpmIndexParams, 'volatilityWeeks'>,
  fitWeeks: number,
  minWeeks: number,
): IndexOutlook | null {
  const target = toDayNumber(targetEnd);
  const h = -referenceT;
  if (h < 1) return null;
  const level = (t: number) => indexLevel(basket, target + 7 * t);
  const history: Array<{ t: number; level: number }> = [];
  for (let t = referenceT - p.volatilityWeeks + 1; t <= referenceT; t++) {
    const l = level(t);
    if (l !== null) history.push({ t, level: l });
  }
  const byT = new Map(history.map((x) => [x.t, x.level]));
  const ref = byT.get(referenceT);
  if (ref === undefined) return null;

  const recent = history.filter((x) => x.t > referenceT - fitWeeks);
  const slope = recent.length >= minWeeks ? theilSen(recent.map((x) => x.t), recent.map((x) => x.level)).slope : null;

  const touchesHoliday = (from: number, to: number) => {
    for (let t = from; t <= to; t++) if (isHolidayWeek(target + 7 * t)) return true;
    return false;
  };
  const keepHolidays = touchesHoliday(referenceT, 0);
  const diffsAt = (lag: number) =>
    history.flatMap((x) => {
      const later = byT.get(x.t + lag);
      if (later === undefined || (!keepHolidays && touchesHoliday(x.t, x.t + lag))) return [];
      return [later - x.level];
    });
  const sdOf = (xs: number[]) => {
    const m = xs.reduce((a, x) => a + x, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  };
  let diffs = diffsAt(h);
  let sd: number;
  if (diffs.length >= 8) sd = sdOf(diffs);
  else {
    diffs = diffsAt(1);
    if (diffs.length < 8) return null;
    sd = sdOf(diffs) * Math.sqrt(h);
  }
  const moves = [4, 12].flatMap((weeks) => {
    for (let lag = weeks; lag < weeks + 4; lag++) {
      const before = byT.get(referenceT - lag);
      if (before !== undefined) return [{ since: fromDayNumber(target + 7 * (referenceT - lag)), change: Math.expm1(ref - before) }];
    }
    return [];
  });
  return { horizonWeeks: h, slope, sd, moves };
}

export interface NpmAdjustedWeek {
  windowEnd: string;
  /** Raw 7-day total, null when a day is missing. */
  total: number | null;
  /** npm index relative to the latest complete week (1 = same level). */
  indexRelative: number | null;
  /** Company downloads at the latest week's npm level: its trend without npm-wide moves. */
  adjusted: number | null;
}

/**
 * Weekly raw vs npm-adjusted downloads for the dashboard, ending at the latest
 * complete week. Shows how much of a company's change is npm-wide.
 */
export function npmAdjustedHistory(
  companyPoints: readonly DataPoint[],
  metricId: string,
  indexPoints: readonly DataPoint[],
  asOf: Date,
  weeks = 26,
  minShareDays = 4,
): NpmAdjustedWeek[] {
  const company = buildDailySeries(companyPoints, metricId, asOf);
  if (company.lastDay === null || company.firstDay === null) return [];
  const basket = buildBasket(indexPoints, asOf);
  const rows: Array<{ end: number; total: number | null; level: number | null; share: number | null }> = [];
  for (let k = 0; k < weeks; k++) {
    const end = company.lastDay - 7 * k;
    if (end - 6 < company.firstDay) break;
    rows.push({ end, total: windowTotal(company, end), level: indexLevel(basket, end), share: logShare(company, basket, end, minShareDays) });
  }
  rows.reverse();
  const ref = [...rows].reverse().find((r) => r.level !== null)?.level ?? null;
  return rows.map((r) => ({
    windowEnd: fromDayNumber(r.end),
    total: r.total,
    indexRelative: ref === null || r.level === null ? null : Math.exp(r.level - ref),
    adjusted: ref === null || r.share === null ? null : Math.exp(r.share + ref),
  }));
}

/** Adds the index move to a fitted forecast: shifts mu and widens sigma (bootstrap replicates too). */
export function addIndexTerm(fc: WeeklyForecast, mean: number, sd: number): WeeklyForecast {
  if (fc.mu === null || fc.sigma === null) return fc;
  return {
    ...fc,
    mu: fc.mu + mean,
    sigma: Math.hypot(fc.sigma, sd),
    boot: fc.boot.map((b) => ({ mu: b.mu + mean, sigma: Math.hypot(b.sigma, sd) })),
  };
}
