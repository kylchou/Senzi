import { describe, expect, it } from 'vitest';
import { computeBaseline, confidenceFor } from './baseline';
import { addDays } from './dates';
import { defaultParams } from './params';
import { sponsorPoint } from './sponsor';
import { asOfAfter, syntheticDaily, testQuestion } from './test-helpers';

const START = '2026-04-01';
// 26 weeks of data: 2026-04-01 .. 2026-09-29
const DAYS = 182;
const LAST = addDays(START, DAYS - 1);
const AS_OF = asOfAfter(LAST);
// Question window ends 4 weeks after the last data day.
const END = addDays(LAST, 28);

const flat = syntheticDaily({ start: START, days: DAYS, level: 1000, noise: 0.05, seed: 7 });

describe('computeBaseline: core behaviour', () => {
  it('gives about 50% when the threshold equals the flat trend level', () => {
    const r = computeBaseline(testQuestion(7000, END), flat, AS_OF);
    expect(r.status).toBe('ok');
    expect(r.probability!).toBeGreaterThan(0.35);
    expect(r.probability!).toBeLessThan(0.65);
    expect(r.bandLabel).toBe('model uncertainty');
    expect(r.method.details.weeksUsed).toBe(16);
    expect(r.method.details.horizonWeeks).toBe(4);
    expect(Math.abs(r.method.details.weeklyGrowth!)).toBeLessThan(0.01);
    expect(r.method.details.forecastMedian!).toBeGreaterThan(6600);
    expect(r.method.details.forecastMedian!).toBeLessThan(7400);
  });

  it('is high far below the trend and low far above it, and decreases with the threshold', () => {
    const ps = [5000, 6000, 6800, 7000, 7200, 8000, 9000].map(
      (t) => computeBaseline(testQuestion(t, END), flat, AS_OF).probability!,
    );
    // Tail shrink keeps the model away from 0% and 100%.
    const cap = defaultParams.tailShrink / 2;
    expect(ps[0]!).toBeGreaterThan(1 - cap - 0.01);
    expect(ps[ps.length - 1]!).toBeLessThan(cap + 0.01);
    expect(Math.max(...ps)).toBeLessThanOrEqual(1 - cap);
    expect(Math.min(...ps)).toBeGreaterThanOrEqual(cap);
    for (let i = 1; i < ps.length; i++) expect(ps[i]!).toBeLessThanOrEqual(ps[i - 1]!);
  });

  it('follows a growth trend', () => {
    const growing = syntheticDaily({ start: START, days: DAYS, level: 1000, weeklyGrowth: 0.03, noise: 0.03, seed: 3 });
    const r = computeBaseline(testQuestion(10_000, END), growing, AS_OF);
    expect(r.method.details.weeklyGrowth!).toBeGreaterThan(0.02);
    expect(r.method.details.weeklyGrowth!).toBeLessThan(0.04);
    // Last observed week is ~1000*1.03^25*7 ≈ 14.7k; four more weeks of growth ≈ 16.5k.
    expect(r.method.details.forecastMedian!).toBeGreaterThan(15_000);
    expect(r.method.details.forecastMedian!).toBeLessThan(18_000);
  });

  it('always keeps the point estimate inside the band', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const pts = syntheticDaily({ start: START, days: DAYS, level: 500, weeklyGrowth: 0.01 * seed - 0.02, noise: 0.15, seed });
      for (const t of [2000, 3000, 3500, 4000, 6000]) {
        const r = computeBaseline(testQuestion(t, END), pts, AS_OF);
        expect(r.low!).toBeLessThanOrEqual(r.probability!);
        expect(r.probability!).toBeLessThanOrEqual(r.high!);
        expect(r.low!).toBeGreaterThanOrEqual(0);
        expect(r.high!).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic and changes only when the data changes', () => {
    const q = testQuestion(7000, END);
    const a = computeBaseline(q, flat, AS_OF);
    const b = computeBaseline(q, flat, AS_OF);
    expect(b).toEqual(a);

    // Later asOf with no new data: same numbers.
    const later = computeBaseline(q, flat, new Date(AS_OF.getTime() + 3 * 86_400_000));
    expect([later.probability, later.low, later.high, later.method.details.inputsHash]).toEqual([
      a.probability,
      a.low,
      a.high,
      a.method.details.inputsHash,
    ]);

    // One more day of data that completes a new week: inputs change.
    const more = syntheticDaily({ start: START, days: DAYS + 7, level: 1000, noise: 0.05, seed: 7 });
    const updated = computeBaseline(q, more, asOfAfter(addDays(LAST, 7)));
    expect(updated.method.details.inputsHash).not.toBe(a.method.details.inputsHash);
  });

  it('never uses data published after asOf', () => {
    const q = testQuestion(7000, END);
    const base = computeBaseline(q, flat, AS_OF);
    const future = syntheticDaily({ start: addDays(LAST, 1), days: 20, level: 50_000, seed: 9 });
    const withFuture = computeBaseline(q, [...flat, ...future], AS_OF);
    expect(withFuture.probability).toBe(base.probability);
    expect(withFuture.method.details.inputsHash).toBe(base.method.details.inputsHash);
  });

  it('reports the outcome when the window is already reported', () => {
    const end = addDays(LAST, -3);
    const yes = computeBaseline(testQuestion(1, end), flat, AS_OF);
    expect(yes).toMatchObject({ status: 'observed', probability: 1, low: 1, high: 1, confidence: 'high' });
    const no = computeBaseline(testQuestion(1e9, end), flat, AS_OF);
    expect(no.probability).toBe(0);
  });

  it('treats threshold 0 as certain', () => {
    expect(computeBaseline(testQuestion(0, END), flat, AS_OF).probability).toBe(1);
  });
});

describe('computeBaseline: thin data', () => {
  it('returns no baseline with fewer than 8 data points', () => {
    const tiny = flat.slice(0, 7);
    const r = computeBaseline(testQuestion(7000, END), tiny, asOfAfter(tiny.at(-1)!.periodEnd));
    expect(r.status).toBe('insufficient_data');
    expect(r.probability).toBeNull();
    expect(r.missing.join(' ')).toMatch(/at least 3 are needed/);
  });

  it('returns no baseline with fewer than 3 complete weeks', () => {
    const two = flat.slice(0, 20);
    const r = computeBaseline(testQuestion(7000, addDays(two.at(-1)!.periodEnd, 14)), two, asOfAfter(two.at(-1)!.periodEnd));
    expect(r.status).toBe('insufficient_data');
    expect(r.method.details.weeksUsed).toBe(2);
  });

  it('shrinks toward 50% and widens the band with 3-7 weeks of data', () => {
    const fiveWeeks = flat.slice(0, 35);
    const last = fiveWeeks.at(-1)!.periodEnd;
    const q = testQuestion(5000, addDays(last, 14));
    const thin = computeBaseline(q, fiveWeeks, asOfAfter(last));
    const full = computeBaseline({ ...q, windowEnd: END, id: 'q-full' }, flat, AS_OF);

    expect(thin.status).toBe('ok');
    expect(thin.method.details.weeksUsed).toBe(5);
    expect(thin.method.details.shrinkWeight).toBeCloseTo(0.7);
    // Shrunk: strictly between 50% and the raw probability.
    const raw = thin.method.details.rawProbability!;
    const W = 0.7 * (1 - defaultParams.tailShrink);
    expect(thin.probability!).toBeCloseTo(W * raw + (1 - W) * 0.5);
    expect(thin.probability!).toBeLessThan(raw);
    expect(thin.high! - thin.low!).toBeGreaterThan(full.high! - full.low!);
    expect(thin.confidence).toBe('low');
    expect(thin.notes.join(' ')).toMatch(/Only 5 weeks of data/);
  });

  it('applies no shrinkage at 8+ weeks', () => {
    const eight = flat.slice(0, 56);
    const last = eight.at(-1)!.periodEnd;
    const r = computeBaseline(testQuestion(7000, addDays(last, 7)), eight, asOfAfter(last));
    expect(r.method.details.shrinkWeight).toBe(1);
    const W = 1 - defaultParams.tailShrink;
    expect(r.probability!).toBeCloseTo(W * r.method.details.rawProbability! + (1 - W) * 0.5, 10);
  });
});

describe('computeBaseline: spikes and missing data', () => {
  it('barely moves when one week has a huge spike, and says so', () => {
    const spikeDays: Record<string, number> = {};
    for (let i = 0; i < 7; i++) spikeDays[addDays(LAST, -40 - i)] = 50_000;
    const spiky = syntheticDaily({ start: START, days: DAYS, level: 1000, noise: 0.05, seed: 7, overrides: spikeDays });
    const q = testQuestion(7000, END);
    const clean = computeBaseline(q, flat, AS_OF);
    const withSpike = computeBaseline(q, spiky, AS_OF);
    // A 7x week moves the forecast by under 2% (least squares would move it far more).
    const c = clean.method.details;
    const s = withSpike.method.details;
    expect(Math.abs(s.forecastMedian! / c.forecastMedian! - 1)).toBeLessThan(0.02);
    expect(Math.abs(s.weeklyGrowth! - c.weeklyGrowth!)).toBeLessThan(0.002);
    // Away from the threshold the probability is essentially unchanged.
    const far = testQuestion(6000, END);
    expect(Math.abs(computeBaseline(far, spiky, AS_OF).probability! - computeBaseline(far, flat, AS_OF).probability!)).toBeLessThan(0.02);
    expect(withSpike.notes.join(' ')).toMatch(/Unusual weeks/);
  });

  it('does not start the forecast from a spike in the latest week', () => {
    const lastWeek: Record<string, number> = {};
    for (let i = 0; i < 7; i++) lastWeek[addDays(LAST, -i)] = 20_000;
    const spiky = syntheticDaily({ start: START, days: DAYS, level: 1000, noise: 0.05, seed: 7, overrides: lastWeek });
    const q = testQuestion(7000, END);
    const r = computeBaseline(q, spiky, AS_OF);
    const clean = computeBaseline(q, flat, AS_OF);
    expect(r.notes.join(' ')).toMatch(/latest week looks unusual/);
    expect(r.method.details.forecastMedian! / clean.method.details.forecastMedian!).toBeLessThan(1.1);
    expect(r.method.details.lastObservedWeek!.total).toBe(140_000);
  });

  it('restarts the fit after a persistent level shift instead of reading it as a trend', () => {
    // Weekly level halves 6 weeks before the data ends (e.g. a counting change), then stays flat.
    const drop: Record<string, number> = {};
    for (let i = 0; i < 42; i++) drop[addDays(LAST, -i)] = 500;
    const shifted = syntheticDaily({ start: START, days: DAYS, level: 1000, noise: 0.03, seed: 5, overrides: drop });
    const q = testQuestion(3500, END);
    const on = computeBaseline(q, shifted, AS_OF);
    const off = computeBaseline(q, shifted, AS_OF, { params: { ...defaultParams, levelShiftThreshold: null } });
    expect(on.notes.join(' ')).toMatch(/Level shift of -50%.*fitted only on the weeks since/);
    expect(on.method.details.weeksUsed).toBe(6);
    // Flat after the shift at about 3,500/week. Without detection the drop distorts both trend and level.
    expect(Math.abs(on.method.details.weeklyGrowth!)).toBeLessThan(0.01);
    expect(Math.abs(on.method.details.forecastMedian! / 3500 - 1)).toBeLessThan(0.05);
    expect(off.method.details.weeklyGrowth!).toBeLessThan(-0.02);
    const errOn = Math.abs(on.method.details.forecastMedian! / 3500 - 1);
    const errOff = Math.abs(off.method.details.forecastMedian! / 3500 - 1);
    expect(errOff).toBeGreaterThan(errOn + 0.03);
  });

  it('notes a shift too recent to refit and keeps the full window', () => {
    const jump: Record<string, number> = {};
    for (let i = 0; i < 14; i++) jump[addDays(LAST, -i)] = 2000;
    const shifted = syntheticDaily({ start: START, days: DAYS, level: 1000, noise: 0.03, seed: 5, overrides: jump });
    const r = computeBaseline(testQuestion(14_000, END), shifted, AS_OF);
    expect(r.notes.join(' ')).toMatch(/Possible level shift of \+\d+%.*too few weeks since/);
    expect(r.method.details.weeksUsed).toBe(16);
  });

  it('leaves incomplete weeks out instead of filling them, and lists them', () => {
    const gaps: Record<string, null> = { [addDays(LAST, -20)]: null, [addDays(LAST, -50)]: null };
    const gappy = syntheticDaily({ start: START, days: DAYS, level: 1000, noise: 0.05, seed: 7, overrides: gaps });
    const r = computeBaseline(testQuestion(7000, END), gappy, AS_OF);
    expect(r.status).toBe('ok');
    expect(r.method.details.weeksUsed).toBe(14);
    expect(r.missing.join(' ')).toMatch(/Incomplete weeks left out of the fit/);
  });

  it('treats an implausible reported zero as missing', () => {
    const zero = syntheticDaily({ start: START, days: DAYS, level: 1000, noise: 0.05, seed: 7, overrides: { [addDays(LAST, -10)]: 0 } });
    const r = computeBaseline(testQuestion(7000, END), zero, AS_OF);
    expect(r.notes.join(' ')).toMatch(/treated as missing/);
    expect(r.missing.join(' ')).toMatch(/Incomplete weeks/);
  });

  it('keeps real zeros in a small series (log(1+y) handles them)', () => {
    const small = syntheticDaily({ start: START, days: DAYS, level: 2, noise: 0, seed: 1 }).map((p, i) => ({
      ...p,
      value: i % 3 === 0 ? 0 : 3,
    }));
    const r = computeBaseline(testQuestion(10, END), small, AS_OF);
    expect(r.status).toBe('ok');
    expect(r.notes.join(' ')).not.toMatch(/treated as missing/);
    expect(Number.isFinite(r.probability!)).toBe(true);
  });

  it('handles a metric with no data at all', () => {
    const r = computeBaseline(testQuestion(7000, END), [], AS_OF);
    expect(r).toMatchObject({ status: 'insufficient_data', probability: null, low: null, high: null, confidence: null });
    expect(r.missing[0]).toMatch(/No npm_downloads:@supabase\/supabase-js data/);
  });

  it('ignores data for other metrics', () => {
    const other = syntheticDaily({ start: START, days: DAYS, level: 99_999, metricId: 'npm_downloads:other', seed: 4 });
    const q = testQuestion(7000, END);
    expect(computeBaseline(q, [...flat, ...other], AS_OF).probability).toBe(computeBaseline(q, flat, AS_OF).probability);
  });
});

describe('computeBaseline: sponsor data', () => {
  const q = testQuestion(7000, END);
  const kpis = (simulated: boolean) =>
    (['arr', 'mrr', 'users'] as const).map((metric, i) =>
      sponsorPoint({
        companyId: 'supabase',
        metric,
        value: 1_000_000 * (i + 1),
        periodStart: addDays(LAST, -30),
        periodEnd: addDays(LAST, -1),
        enteredAt: '2026-09-01T00:00:00Z',
        simulated,
      }),
    );

  it('ARR, MRR and user counts never change the baseline', () => {
    const without = computeBaseline(q, flat, AS_OF);
    for (const simulated of [true, false]) {
      const withKpis = computeBaseline(q, flat, AS_OF, { sponsorPoints: kpis(simulated) });
      expect(withKpis).toEqual(without);
    }
  });

  it("sponsor totals for the question's own metric fill only weeks scraped data is missing", () => {
    const missingWeekEnd = addDays(END, -7 * 6); // a week inside the fit window
    const drop: Record<string, null> = { [addDays(missingWeekEnd, -2)]: null };
    const gappy = syntheticDaily({ start: START, days: DAYS, level: 1000, noise: 0.05, seed: 7, overrides: drop });
    const fill = sponsorPoint({
      companyId: 'supabase',
      metric: { metricId: q.metricId },
      value: 7000,
      periodStart: addDays(missingWeekEnd, -6),
      periodEnd: missingWeekEnd,
      enteredAt: '2026-09-01T00:00:00Z',
      simulated: true,
    });
    const before = computeBaseline(q, gappy, AS_OF);
    const after = computeBaseline(q, gappy, AS_OF, { sponsorPoints: [fill] });
    expect(after.method.details.weeksUsed).toBe(before.method.details.weeksUsed + 1);
    expect(after.inputsUsed.map((i) => [i.provenance, i.role, i.simulated])).toEqual([
      ['scraped', 'trend', false],
      ['sponsor_provided', 'sponsor_fill', true],
    ]);
    expect(after.notes.join(' ')).toMatch(/Sponsor-provided totals filled 1 week/);
  });

  it('scraped data wins where both exist', () => {
    const conflicting = sponsorPoint({
      companyId: 'supabase',
      metric: { metricId: q.metricId },
      value: 1_000_000,
      periodStart: addDays(END, -7 * 6 - 6),
      periodEnd: addDays(END, -7 * 6),
      enteredAt: '2026-09-01T00:00:00Z',
      simulated: true,
    });
    expect(computeBaseline(q, flat, AS_OF, { sponsorPoints: [conflicting] })).toEqual(computeBaseline(q, flat, AS_OF));
  });
});

describe('confidenceFor', () => {
  const base = { weeksUsed: 16, horizonWeeks: 2, bandWidth: 0.1, missingWeeks: 0, recentSpike: false, params: defaultParams };
  it('grades confidence', () => {
    expect(confidenceFor(base)).toBe('high');
    expect(confidenceFor({ ...base, horizonWeeks: 6 })).toBe('medium');
    expect(confidenceFor({ ...base, missingWeeks: 1 })).toBe('medium');
    expect(confidenceFor({ ...base, weeksUsed: 7 })).toBe('low');
    expect(confidenceFor({ ...base, bandWidth: 0.6 })).toBe('low');
    expect(confidenceFor({ ...base, recentSpike: true })).toBe('low');
  });
});
