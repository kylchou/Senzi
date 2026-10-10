import { describe, expect, it } from 'vitest';
import { baselineFor, trafficQuestion } from './question-kinds';
import { syntheticDaily } from './test-helpers';

// About six weeks of daily Tranco ranks near #2,100, improving slowly (lower is better).
const ranks = syntheticDaily({
  companyId: 'posthog',
  metricId: 'tranco_rank',
  start: '2026-08-20',
  days: 42,
  level: 2150,
  weeklyGrowth: -0.01,
  noise: 0.01,
  seed: 7,
}).map((p) => ({ ...p, source: 'tranco' as const }));
const asOf = new Date('2026-10-02T00:00:00Z');

describe('traffic_rank baseline', () => {
  it('reports details as average ranks and P(YES), not 7-day rank totals for the complement', () => {
    const q = trafficQuestion('posthog', 2100, '2026-11-08', asOf.toISOString());
    const b = baselineFor(q, ranks, asOf);
    expect(b.probability).not.toBeNull();
    const d = b.method.details;

    // Averages land near the observed daily ranks (~2,100), not 7x that.
    expect(d.lastObservedWeek!.total).toBeGreaterThan(1500);
    expect(d.lastObservedWeek!.total).toBeLessThan(2600);
    expect(d.forecastMedian!).toBeLessThan(2600);
    expect(d.forecastRange80![0]).toBeLessThanOrEqual(d.forecastMedian!);
    expect(d.forecastRange80![1]).toBeGreaterThanOrEqual(d.forecastMedian!);

    // The raw probability is for the same event as the final one: shrinking
    // toward 50% never flips it to the other side.
    const raw = d.rawProbability!;
    expect((raw - 0.5) * (b.probability! - 0.5)).toBeGreaterThanOrEqual(0);
    expect(Math.abs(b.probability! - 0.5)).toBeLessThanOrEqual(Math.abs(raw - 0.5) + 1e-9);
  });

  it('is more likely YES when the projected average rank beats the line', () => {
    const easy = baselineFor(trafficQuestion('posthog', 3000, '2026-11-08', asOf.toISOString()), ranks, asOf);
    const hard = baselineFor(trafficQuestion('posthog', 1500, '2026-11-08', asOf.toISOString()), ranks, asOf);
    expect(easy.probability!).toBeGreaterThan(0.5);
    expect(hard.probability!).toBeLessThan(0.5);
  });
});
