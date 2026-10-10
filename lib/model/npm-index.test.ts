import { describe, expect, it } from 'vitest';
import { computeBaseline } from './baseline';
import { metricIds, NPM_INDEX_ID, NPM_INDEX_PACKAGES } from './catalog';
import { addDays, toDayNumber } from './dates';
import { buildBasket, indexLevel, isHolidayWeek, npmAdjustedHistory } from './npm-index';
import { defaultParams } from './params';
import { buildDailySeries } from './series';
import { asOfAfter, syntheticDaily, testQuestion } from './test-helpers';
import type { DataPoint } from './types';

const START = '2026-03-01';
const DAYS = 217; // through 2026-10-03, a Saturday
const LAST = addDays(START, DAYS - 1);
const COMPANY = 'npm_downloads:@supabase/supabase-js';

/** Multiplies every value from `from` on (a step shared by everything it is applied to). */
const step = (points: DataPoint[], from: string, factor: number) =>
  points.map((p) => (p.periodEnd >= from ? { ...p, value: Math.round(p.value * factor) } : p));

const zeroOn = (points: DataPoint[], days: string[]) => points.map((p) => (days.includes(p.periodEnd) ? { ...p, value: 0 } : p));

function basket(opts: { weeklyGrowth?: number; jumpFrom?: string; jump?: number; zeros?: string[] } = {}): DataPoint[] {
  return NPM_INDEX_PACKAGES.flatMap((pkg, i) => {
    let pts = syntheticDaily({
      companyId: NPM_INDEX_ID,
      metricId: metricIds.npm(pkg),
      start: START,
      days: DAYS,
      level: 1e6 * (i + 1),
      weeklyGrowth: opts.weeklyGrowth ?? 0,
      noise: 0.02,
      weekendFactor: 0.5,
      seed: 100 + i,
    });
    if (opts.jumpFrom) pts = step(pts, opts.jumpFrom, opts.jump ?? 1.35);
    if (opts.zeros) pts = zeroOn(pts, opts.zeros);
    return pts;
  });
}

function company(opts: { weeklyGrowth?: number; jumpFrom?: string; jump?: number; zeros?: string[] } = {}): DataPoint[] {
  let pts = syntheticDaily({ start: START, days: DAYS, level: 2e6, weeklyGrowth: opts.weeklyGrowth ?? 0, noise: 0.03, weekendFactor: 0.5, seed: 7 });
  if (opts.jumpFrom) pts = step(pts, opts.jumpFrom, opts.jump ?? 1.35);
  if (opts.zeros) pts = zeroOn(pts, opts.zeros);
  return pts;
}

const asOf = asOfAfter(LAST);
const question = (threshold: number) => testQuestion(threshold, addDays(LAST, 22));

describe('npm index', () => {
  it('is the mean log 7-day total across the basket, and null when a package is missing a day', () => {
    const pts = basket();
    const b = buildBasket(pts, asOf);
    const end = toDayNumber(LAST);
    const level = indexLevel(b, end)!;
    const expected =
      NPM_INDEX_PACKAGES.map((pkg) => {
        const s = buildDailySeries(pts, metricIds.npm(pkg), asOf);
        let t = 0;
        for (let d = end - 6; d <= end; d++) t += s.values.get(d)!;
        return Math.log(t);
      }).reduce((a, x) => a + x, 0) / NPM_INDEX_PACKAGES.length;
    expect(level).toBeCloseTo(expected, 10);

    const gap = pts.filter((p) => !(p.metricId === metricIds.npm('react') && p.periodEnd === LAST));
    expect(indexLevel(buildBasket(gap, asOf), end)).toBeNull();
  });

  it('never uses index counts published after asOf', () => {
    const b = buildBasket(basket(), asOfAfter(addDays(LAST, -7)));
    expect(indexLevel(b, toDayNumber(LAST))).toBeNull();
    expect(indexLevel(b, toDayNumber(LAST) - 7)).not.toBeNull();
  });

  it('separates npm-wide growth from company growth', () => {
    const pts = company({ weeklyGrowth: 0.03 });
    const ix = basket({ weeklyGrowth: 0.03 });
    const raw = computeBaseline(question(2.4e6 * 7), pts, asOf, { params: { ...defaultParams, npmIndex: null } });
    const adjusted = computeBaseline(question(2.4e6 * 7), pts, asOf, { npmIndexPoints: ix });

    expect(raw.method.details.weeklyGrowth!).toBeCloseTo(0.03, 2);
    const d = adjusted.method.details.npmIndex!;
    expect(Math.abs(d.relativeWeeklyGrowth)).toBeLessThan(0.005);
    expect(d.indexWeeklyTrend!).toBeCloseTo(0.03, 2);
    expect(d.indexMoves[0]!.change).toBeGreaterThan(0.1);
    expect(adjusted.notes.some((n) => n.includes('npm-wide downloads'))).toBe(true);
  });

  it("keeps a company's own growth when npm is flat", () => {
    const r = computeBaseline(question(2e6 * 7), company({ weeklyGrowth: 0.02 }), asOf, { npmIndexPoints: basket() });
    expect(r.method.details.npmIndex!.relativeWeeklyGrowth).toBeCloseTo(0.02, 2);
  });

  it('values outage weeks relative to npm instead of dropping them', () => {
    const outage = [addDays(LAST, -10), addDays(LAST, -24)];
    const pts = company({ zeros: outage });
    const raw = computeBaseline(question(2e6 * 7), pts, asOf, { params: { ...defaultParams, npmIndex: null } });
    const r = computeBaseline(question(2e6 * 7), pts, asOf, { npmIndexPoints: basket({ zeros: outage }) });
    expect(raw.missing.join(' ')).toContain('Incomplete weeks');
    expect(r.method.details.npmIndex!.recoveredWeeks).toHaveLength(2);
    expect(r.missing.join(' ')).not.toContain('Incomplete weeks');
    expect(r.method.details.weeksUsed).toBeGreaterThan(raw.method.details.weeksUsed);
  });

  it('records the index as an input and widens the forecast with its uncertainty', () => {
    const pts = company();
    const raw = computeBaseline(question(2e6 * 7), pts, asOf, { params: { ...defaultParams, npmIndex: null } });
    const r = computeBaseline(question(2e6 * 7), pts, asOf, { npmIndexPoints: basket() });
    const idx = r.inputsUsed.find((i) => i.role === 'market_index');
    expect(idx).toMatchObject({ metricId: 'npm_index', source: 'npm', provenance: 'scraped', simulated: false });
    expect(r.method.details.npmIndex!.indexSd).toBeGreaterThan(0);
    expect(r.method.description).toContain('npm-wide index');
    expect(raw.method.description).not.toContain('npm-wide index');
  });

  it('falls back to raw downloads without index data, and ignores the index for other sources', () => {
    const r = computeBaseline(question(2e6 * 7), company(), asOf);
    expect(r.method.details.npmIndex).toBeNull();
    expect(r.notes.some((n) => n.includes('index unavailable'))).toBe(true);

    const pypi = syntheticDaily({ metricId: 'pypi_downloads:supabase', start: START, days: DAYS, level: 2e5, noise: 0.03, seed: 3 });
    const q = testQuestion(2e5 * 7, addDays(LAST, 22), { metricId: 'pypi_downloads:supabase' });
    const p = computeBaseline(q, pypi, asOf, { npmIndexPoints: basket() });
    expect(p.method.details.npmIndex).toBeNull();
    expect(p.notes.some((n) => n.includes('index unavailable'))).toBe(false);
  });

  it('changes the inputs hash when the index changes', () => {
    const pts = company();
    const a = computeBaseline(question(2e6 * 7), pts, asOf, { npmIndexPoints: basket() });
    const b = computeBaseline(question(2e6 * 7), pts, asOf, { npmIndexPoints: basket({ jumpFrom: addDays(LAST, -6) }) });
    expect(a.method.details.inputsHash).not.toBe(b.method.details.inputsHash);
  });

  it('flags the year-end holiday weeks', () => {
    expect(isHolidayWeek(toDayNumber('2025-12-28'))).toBe(true);
    expect(isHolidayWeek(toDayNumber('2026-01-11'))).toBe(true);
    expect(isHolidayWeek(toDayNumber('2026-01-18'))).toBe(false);
    expect(isHolidayWeek(toDayNumber('2026-10-04'))).toBe(false);
  });

  it('gives the dashboard a raw vs npm-adjusted weekly history', () => {
    const jumpFrom = addDays(LAST, -27);
    const rows = npmAdjustedHistory(company({ jumpFrom }), COMPANY, basket({ jumpFrom }), asOf, 12);
    expect(rows).toHaveLength(12);
    const first = rows[0]!;
    const last = rows.at(-1)!;
    expect(last.total! / first.total!).toBeGreaterThan(1.25);
    expect(last.adjusted! / first.adjusted!).toBeGreaterThan(0.9);
    expect(last.adjusted! / first.adjusted!).toBeLessThan(1.1);
    expect(last.indexRelative).toBeCloseTo(1, 10);
    expect(first.indexRelative!).toBeLessThan(0.8);
  });
});
