// Synthetic data for model tests. Not used outside tests.

import { addDays } from './dates.js';
import { seededRandom } from './math.js';
import { makeQuestion } from './questions.js';
import type { DataPoint, ThresholdQuestion } from './types.js';

export interface SyntheticSeries {
  companyId?: string;
  metricId?: string;
  start: string;
  days: number;
  /** Mean daily value on the first day. */
  level: number;
  /** Compound growth per week (0.02 = +2%/week). */
  weeklyGrowth?: number;
  /** Multiplicative day-to-day noise (sd of log). */
  noise?: number;
  /** Weekend multiplier (npm traffic dips on weekends). */
  weekendFactor?: number;
  seed?: number;
  /** Override individual days: day -> value, or null to drop the day. */
  overrides?: Record<string, number | null>;
}

export function syntheticDaily(s: SyntheticSeries): DataPoint[] {
  const rand = seededRandom(s.seed ?? 1);
  const gauss = () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const out: DataPoint[] = [];
  for (let i = 0; i < s.days; i++) {
    const day = addDays(s.start, i);
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    let value =
      s.level *
      Math.pow(1 + (s.weeklyGrowth ?? 0), i / 7) *
      (dow === 0 || dow === 6 ? s.weekendFactor ?? 1 : 1) *
      Math.exp((s.noise ?? 0) * gauss());
    value = Math.round(value);
    if (s.overrides && day in s.overrides) {
      const o = s.overrides[day];
      if (o === null) continue;
      value = o!;
    }
    out.push({
      companyId: s.companyId ?? 'supabase',
      metricId: s.metricId ?? 'npm_downloads:@supabase/supabase-js',
      source: 'npm',
      value,
      periodStart: day,
      periodEnd: day,
      availableAt: `${addDays(day, 1)}T12:00:00.000Z`,
      fetchedAt: '2026-10-09T00:00:00.000Z',
      sourceUrl: 'https://api.npmjs.org/downloads/range/test',
      provenance: 'scraped',
      simulated: false,
    });
  }
  return out;
}

export function testQuestion(threshold: number, windowEnd: string, overrides: Partial<ThresholdQuestion> = {}): ThresholdQuestion {
  return {
    ...makeQuestion({
      id: overrides.id ?? 'q-test',
      companyId: 'supabase',
      metricId: 'npm_downloads:@supabase/supabase-js',
      threshold,
      windowEnd,
      opensAt: '2026-10-01T00:00:00.000Z',
    }),
    ...overrides,
  };
}

/** asOf just after the given day's data became available. */
export const asOfAfter = (day: string) => new Date(`${addDays(day, 1)}T13:00:00.000Z`);
