// Turns stored data points into the weekly series the trend is fitted on.
//
// - Point in time: only points whose `availableAt` is at or before `asOf` count.
// - Zero days: download counters sometimes report 0 for a day they failed to
//   count. A zero surrounded by large values is treated as missing, not as a
//   real zero. A zero in a genuinely small series is kept.
// - Weeks: 7-day totals aligned so one window ends exactly on the question's
//   window end. A week with any missing day is left out, never filled in.

import { fromDayNumber, toDayNumber } from './dates.js';
import { median } from './math.js';
import type { DataPoint } from './types.js';

export interface DailySeries {
  metricId: string;
  /** day number -> value */
  values: Map<number, number>;
  firstDay: number | null;
  lastDay: number | null;
  /** Days whose reported 0 was treated as missing. */
  zeroDaysTreatedAsMissing: string[];
  sourceUrls: string[];
  latestFetchedAt: string | null;
  points: number;
}

/** Median of nearby non-zero values above which a reported 0 is implausible. */
const IMPLAUSIBLE_ZERO_LEVEL = 50;

export function buildDailySeries(points: readonly DataPoint[], metricId: string, asOf: Date): DailySeries {
  const cutoff = asOf.getTime();
  const byDay = new Map<number, DataPoint>();
  for (const p of points) {
    if (p.metricId !== metricId || p.provenance !== 'scraped') continue;
    if (Date.parse(p.availableAt) > cutoff) continue;
    const day = toDayNumber(p.periodEnd);
    const prev = byDay.get(day);
    if (!prev || prev.fetchedAt < p.fetchedAt) byDay.set(day, p);
  }

  const days = [...byDay.keys()].sort((a, b) => a - b);
  // Leading zeros mean the package didn't exist yet.
  while (days.length && byDay.get(days[0]!)!.value === 0) days.shift();

  const values = new Map<number, number>();
  for (const d of days) values.set(d, byDay.get(d)!.value);

  const zeroDaysTreatedAsMissing: string[] = [];
  for (const d of days) {
    if (values.get(d) !== 0) continue;
    const nearby: number[] = [];
    for (let o = -14; o <= 14; o++) {
      const v = byDay.get(d + o)?.value;
      if (v !== undefined && v > 0) nearby.push(v);
    }
    if (nearby.length && median(nearby) >= IMPLAUSIBLE_ZERO_LEVEL) {
      values.delete(d);
      zeroDaysTreatedAsMissing.push(fromDayNumber(d));
    }
  }

  const kept = [...values.keys()];
  const used = [...byDay.entries()].filter(([d]) => values.has(d)).map(([, p]) => p);
  return {
    metricId,
    values,
    firstDay: kept.length ? Math.min(...kept) : null,
    lastDay: kept.length ? Math.max(...kept) : null,
    zeroDaysTreatedAsMissing,
    sourceUrls: [...new Set(used.map((p) => p.sourceUrl))],
    latestFetchedAt: used.reduce<string | null>((m, p) => (m === null || p.fetchedAt > m ? p.fetchedAt : m), null),
    points: values.size,
  };
}

/** Total of the 7 days ending on `endDay`, or null if any day is missing. */
export function windowTotal(series: DailySeries, endDay: number, days = 7): number | null {
  let total = 0;
  for (let d = endDay - days + 1; d <= endDay; d++) {
    const v = series.values.get(d);
    if (v === undefined) return null;
    total += v;
  }
  return total;
}

export interface WeeklyPoint {
  /** Weeks relative to the target window: the target is t = 0, the week before it t = -1. */
  t: number;
  windowEnd: string;
  total: number | null;
}

export interface WeeklySeries {
  /** Ascending by t. Includes missing weeks (total null) inside the range. */
  weeks: WeeklyPoint[];
  /** Weeks between the last observed week and the target window. 0 means the target is observed. */
  horizonWeeks: number;
}

/**
 * Weekly totals aligned to `targetEnd`, newest first going back at most
 * `maxWeeks` windows, stopping at the start of the data.
 */
export function weeklySeries(series: DailySeries, targetEnd: string, maxWeeks: number): WeeklySeries {
  const target = toDayNumber(targetEnd);
  if (series.lastDay === null || series.firstDay === null) return { weeks: [], horizonWeeks: 0 };
  const horizonWeeks = Math.max(0, Math.ceil((target - series.lastDay) / 7));
  const weeks: WeeklyPoint[] = [];
  for (let k = Math.max(horizonWeeks, 1); weeks.length < maxWeeks; k++) {
    const end = target - 7 * k;
    if (end - 6 < series.firstDay) break;
    weeks.push({ t: -k, windowEnd: fromDayNumber(end), total: windowTotal(series, end) });
  }
  return { weeks: weeks.reverse(), horizonWeeks };
}
