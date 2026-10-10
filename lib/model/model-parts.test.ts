import { describe, expect, it } from 'vitest';
import { addDays, fromDayNumber, toDayNumber } from './dates';
import { getBaseline, MODEL_VERSION, refreshBaseline, toEngineBaseline, toMarketModelFields, QuestionNotFoundError } from './index';
import { getCompanyIndicators } from './indicators';
import { median, normalCdf, quantile, robustScale, seededRandom, seedFrom } from './math';
import { makeQuestion, questionText, resolveQuestion } from './questions';
import { buildDailySeries, weeklySeries, windowTotal } from './series';
import { crossCheckSponsor, sponsorPoint } from './sponsor';
import { MemoryModelStore } from './store';
import { asOfAfter, syntheticDaily, testQuestion } from './test-helpers';
import { findLevelShift } from './forecast';
import { fitTrend, theilSen } from './trend';

describe('math', () => {
  it('computes the normal CDF', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6);
    expect(normalCdf(1.2815516)).toBeCloseTo(0.9, 6);
    expect(normalCdf(-8)).toBeCloseTo(0, 10);
    expect(normalCdf(Infinity)).toBe(1);
    expect(normalCdf(-Infinity)).toBe(0);
  });

  it('computes robust statistics', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4);
    expect(quantile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6);
    expect(robustScale([0, 0, 0, 0, 100])).toBe(0);
  });

  it('produces deterministic random streams', () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(seedFrom('a', 'b')).toBe(seedFrom('a', 'b'));
    expect(seedFrom('a', 'b')).not.toBe(seedFrom('a', 'c'));
  });
});

describe('dates', () => {
  it('round-trips days', () => {
    expect(fromDayNumber(toDayNumber('2026-10-09'))).toBe('2026-10-09');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(() => toDayNumber('2026-13-01')).toThrow();
    expect(() => toDayNumber('10/09/2026')).toThrow();
  });
});

describe('findLevelShift', () => {
  it('finds a persistent step and ignores single spikes and smooth growth', () => {
    expect(findLevelShift([1, 1, 1, 1, 2, 2, 2], 0.5)).toBe(4);
    expect(findLevelShift([2, 2, 2, 1, 1, 1], 0.5)).toBe(3);
    expect(findLevelShift([1, 1, 1, 3, 1, 1, 1], 0.5)).toBeNull();
    expect(findLevelShift([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6], 0.5)).toBeNull();
    expect(findLevelShift([1, 1, 1.4, 1.4], 0.5)).toBeNull();
  });
});

describe('trend', () => {
  it('recovers an exact line', () => {
    const f = fitTrend([0, 1, 2, 3, 4], [1, 3, 5, 7, 9]);
    expect(f.slope).toBeCloseTo(2);
    expect(f.intercept).toBeCloseTo(1);
    expect(f.scale).toBeCloseTo(0);
  });

  it('ignores a single outlier', () => {
    const { slope } = theilSen([0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 100, 4, 5, 6]);
    expect(slope).toBeCloseTo(1);
  });

  it('rejects degenerate input', () => {
    expect(() => theilSen([1], [1])).toThrow();
    expect(() => theilSen([1, 1], [1, 2])).toThrow();
  });
});

describe('series', () => {
  const pts = syntheticDaily({ start: '2026-01-01', days: 70, level: 100, seed: 2 });

  it('aligns weeks to the target window end and computes the horizon', () => {
    const s = buildDailySeries(pts, 'npm_downloads:@supabase/supabase-js', asOfAfter('2026-03-11'));
    expect(fromDayNumber(s.lastDay!)).toBe('2026-03-11');
    const w = weeklySeries(s, '2026-03-25', 16);
    expect(w.horizonWeeks).toBe(2);
    expect(w.weeks.at(-1)!).toMatchObject({ t: -2, windowEnd: '2026-03-11' });
    expect(w.weeks.at(-1)!.total).toBe(windowTotal(s, toDayNumber('2026-03-11')));
    // A target that doesn't line up with the data end still gives whole weeks.
    const off = weeklySeries(s, '2026-03-14', 16);
    expect(off.horizonWeeks).toBe(1);
    expect(off.weeks.at(-1)!.windowEnd).toBe('2026-03-07');
  });

  it('keeps the newest copy of a re-fetched day', () => {
    const dup = { ...pts[5]!, value: 999_999, fetchedAt: '2027-01-01T00:00:00Z' };
    const s = buildDailySeries([...pts, dup], dup.metricId, asOfAfter('2026-03-11'));
    expect(s.values.get(toDayNumber(dup.periodEnd))).toBe(999_999);
  });

  it('drops leading zeros (package did not exist yet)', () => {
    const lead = [0, 0, 0].map((v, i) => ({ ...pts[0]!, value: v, periodStart: addDays('2025-12-29', i), periodEnd: addDays('2025-12-29', i) }));
    const s = buildDailySeries([...lead, ...pts], pts[0]!.metricId, asOfAfter('2026-03-11'));
    expect(fromDayNumber(s.firstDay!)).toBe('2026-01-01');
  });

  it('ignores sponsor-provided points', () => {
    const sp = { ...pts[0]!, provenance: 'sponsor_provided' as const, periodEnd: '2026-03-20', periodStart: '2026-03-20' };
    const s = buildDailySeries([...pts, sp], pts[0]!.metricId, asOfAfter('2026-03-30'));
    expect(fromDayNumber(s.lastDay!)).toBe('2026-03-11');
  });
});

describe('questions', () => {
  it('spells out the window', () => {
    expect(questionText('supabase', 'npm_downloads:@supabase/supabase-js', 2_500_000, '2026-11-08')).toBe(
      "Will Supabase's npm downloads reach 2.5M in the 7 days ending Nov 8?",
    );
  });

  it('names the resolution source up front', () => {
    const q = testQuestion(100, '2026-03-11');
    expect(q.resolutionSource).toMatchObject({
      source: 'npm',
      url: 'https://api.npmjs.org/downloads/range/2026-03-05:2026-03-11/@supabase/supabase-js',
    });
  });

  it('refuses metrics that cannot be resolved as a 7-day total', () => {
    const base = { id: 'x', companyId: 'supabase', threshold: 5, windowEnd: '2026-03-11', opensAt: '2026-03-01T00:00:00Z' };
    expect(() => makeQuestion({ ...base, metricId: 'github_stars:supabase/supabase' })).toThrow(/daily count/);
    expect(() => makeQuestion({ ...base, metricId: 'github_commits_weekly:supabase/supabase' })).toThrow(/daily count/);
    expect(() => makeQuestion({ ...base, metricId: 'open_jobs' })).toThrow(/daily count/);
    expect(() => makeQuestion({ ...base, metricId: 'npm_downloads:@supabase/supabase-js', threshold: -1 })).toThrow();
    expect(() => makeQuestion({ ...base, metricId: 'npm_downloads:@supabase/supabase-js', windowEnd: '2026-3-11' })).toThrow();
  });

  it('resolves from scraped data only', () => {
    const pts = syntheticDaily({ start: '2026-01-01', days: 70, level: 100, seed: 2 });
    const total = windowTotal(buildDailySeries(pts, pts[0]!.metricId, asOfAfter('2026-03-11')), toDayNumber('2026-03-11'))!;
    const asOf = asOfAfter('2026-03-11');
    expect(resolveQuestion(testQuestion(total, '2026-03-11'), pts, asOf)).toMatchObject({ status: 'resolved', outcome: 'YES', observedTotal: total });
    expect(resolveQuestion(testQuestion(total + 1, '2026-03-11'), pts, asOf).outcome).toBe('NO');
    expect(resolveQuestion(testQuestion(1, '2026-03-20'), pts, asOf)).toMatchObject({ status: 'pending', reason: 'Window not fully reported yet' });
    const gap = pts.filter((p) => p.periodEnd !== '2026-03-09');
    expect(resolveQuestion(testQuestion(1, '2026-03-11'), gap, asOf)).toMatchObject({ status: 'pending', reason: 'Days missing in the window' });
  });
});

describe('sponsor data and indicators', () => {
  const pts = syntheticDaily({ start: '2026-01-01', days: 120, level: 1000, weeklyGrowth: 0.02, seed: 2 });
  const arr = (value: number, end: string) =>
    sponsorPoint({ companyId: 'supabase', metric: 'arr', value, periodStart: end, periodEnd: end, enteredAt: '2026-04-20T00:00:00Z', simulated: true });

  it('validates sponsor entries', () => {
    expect(() => arr(-1, '2026-03-01')).toThrow();
    expect(() =>
      sponsorPoint({ companyId: 'x', metric: 'mrr', value: 1, periodStart: '2026-03-02', periodEnd: '2026-03-01', enteredAt: '2026-04-01T00:00:00Z', simulated: true }),
    ).toThrow();
  });

  it('labels sponsor values everywhere they appear, including simulated ones', () => {
    const rows = getCompanyIndicators('supabase', pts, [arr(10_000_000, '2026-03-31')], asOfAfter('2026-04-30'));
    const arrRow = rows.find((r) => r.metricId === 'sponsor_arr')!;
    expect(arrRow).toMatchObject({ value: 10_000_000, provenance: 'sponsor_provided', simulated: true });
    expect(arrRow.provenanceLabel).toMatch(/SIMULATED/);
    expect(rows.find((r) => r.metricId === 'sponsor_users')!.missingReason).toBe('Not provided by the sponsor');
    const npmRow = rows.find((r) => r.metricId === 'npm_downloads:@supabase/supabase-js')!;
    expect(npmRow.provenance).toBe('scraped');
    expect(npmRow.change4w!).toBeGreaterThan(0.05);
    expect(rows.find((r) => r.metricId === 'open_jobs')!.missingReason).toBe('No data collected for this metric');
  });

  it('cross-checks sponsor growth against scraped growth, informationally', () => {
    const checks = crossCheckSponsor(
      [arr(10_000_000, '2026-02-28'), arr(12_000_000, '2026-03-31')],
      pts,
      'npm_downloads:@supabase/supabase-js',
      asOfAfter('2026-04-30'),
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]!.sponsorChange).toBeCloseTo(0.2);
    expect(checks[0]!.scrapedChange!).toBeGreaterThan(0.05);
    expect(checks[0]!.note).toMatch(/No rule yet/);
  });
});

describe('public API', () => {
  const pts = syntheticDaily({ start: '2026-04-01', days: 182, level: 1000, noise: 0.05, seed: 7 });
  const q = testQuestion(7000, '2026-10-27', { id: 'q1' });

  it('getBaseline reads the question and data from the store', () => {
    const store = new MemoryModelStore(pts, [], [q]);
    const r = getBaseline('q1', { store, asOf: asOfAfter('2026-09-29') });
    expect(r.status).toBe('ok');
    expect(() => getBaseline('nope', { store })).toThrow(QuestionNotFoundError);
  });

  it('refreshBaseline stores a snapshot only when inputs change', () => {
    const store = new MemoryModelStore(pts.slice(0, 175), [], [q]);
    expect(refreshBaseline('q1', { store, asOf: asOfAfter('2026-09-22') }).changed).toBe(true);
    expect(refreshBaseline('q1', { store, asOf: asOfAfter('2026-09-23') }).changed).toBe(false);
    store.points = pts;
    expect(refreshBaseline('q1', { store, asOf: asOfAfter('2026-09-29') }).changed).toBe(true);
    expect(store.snapshots).toHaveLength(2);
  });

  it('converts to the forecasting engine baseline', () => {
    const store = new MemoryModelStore(pts, [], [q]);
    const r = getBaseline('q1', { store, asOf: asOfAfter('2026-09-29') });
    const e = toEngineBaseline(r)!;
    expect(e.value).toBe(r.probability);
    expect(e.modelVersion).toBe(`log-trend-theil-sen@${MODEL_VERSION}`);
    expect(e.inputsNote).toMatch(/scraped/);
    expect(toEngineBaseline({ ...r, probability: null })).toBeNull();
  });

  it("maps onto the Market columns Ky's schema defines", () => {
    const store = new MemoryModelStore(pts, [], [q]);
    const r = getBaseline('q1', { store, asOf: asOfAfter('2026-09-29') });
    const m = toMarketModelFields(r)!;
    expect(Object.keys(m).sort()).toEqual(
      ['baselineMethodology', 'baselineSetAt', 'modelInputsNote', 'modelUpdatedAt', 'modelValue', 'modelVersion', 'openingBaseline'].sort(),
    );
    expect(m.openingBaseline).toBe(r.probability);
    expect(m.baselineMethodology).toMatch(/Model uncertainty band: \d+%–\d+%/);
    expect(m.baselineMethodology).toMatch(/Trades never feed the model/);
    expect(toMarketModelFields({ ...r, probability: null })).toBeNull();
  });
});
