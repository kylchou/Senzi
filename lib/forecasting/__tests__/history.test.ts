import { describe, expect, it } from 'vitest';
import { selectHistory, snapshotAt, snapshotsToCsv } from '../history';
import type { MarketSnapshot } from '../index';
import { expectCode, setup, T0 } from './helpers';

function snap(sequence: number, minutes: number, general: number | null = null): MarketSnapshot {
  return {
    marketId: 'm',
    sequence,
    at: new Date(T0.getTime() + minutes * 60_000),
    trigger: 'forecast',
    openingBaseline: 0.4,
    model: 0.4,
    general,
    specialized: null,
    generalForecasters: sequence,
    specializedForecasters: 0,
    generalAmount: sequence * 10,
    specializedAmount: 0,
    estimateRuleId: 'r',
    estimateKind: 'allocation_share',
  };
}

describe('history recording', () => {
  it('records one timestamped snapshot per forecast and preserves original entry info', async () => {
    const t = setup();
    const m = await t.createMarket();
    for (const u of ['a', 'b', 'c']) await t.fund(u);

    const first = await t.forecast('a', m.id, 'YES');
    t.clock.advance(60_000);
    await t.forecast('b', m.id, 'NO');
    t.clock.advance(60_000);
    await t.forecast('c', m.id, 'NO');

    const history = await t.engine.getHistory(m.id);
    expect(history.map((s) => s.general)).toEqual([1, 0.5, 1 / 3]);
    expect(history.map((s) => s.at.getTime() - T0.getTime())).toEqual([0, 60_000, 120_000]);
    expect(history.map((s) => s.forecastId)).toEqual((await t.repo.listForecastsByMarket(m.id)).map((f) => f.id));

    // The first forecast's stored entry is unchanged by later forecasts.
    const stored = (await t.repo.listForecastsByMarket(m.id))[0]!;
    expect(stored.entry).toEqual(first.entry);
    expect(stored.entry.generalAfter).toBe(1);
    // Replaying the receipt later gives the same digest.
    const replay = await t.forecast('a', m.id, 'YES', 10, 'k1');
    expect(replay.digest).toBe(first.digest);
  });

  it('produces three chart series', async () => {
    const t = setup();
    const m = await t.createMarket();
    t.traders.verify('v', 'acme');
    await t.fund('v');
    await t.fund('g');
    await t.forecast('v', m.id, 'YES');
    await t.forecast('g', m.id, 'NO');
    const series = await t.engine.getChartSeries(m.id);
    expect(series.estimateKind).toBe('allocation_share');
    expect(series.openingBaseline).toBe(0.4);
    expect(series.model.map((p) => p.value)).toEqual([0.4, 0.4]);
    expect(series.general.map((p) => p.value)).toEqual([1, 0.5]);
    expect(series.specialized.map((p) => p.value)).toEqual([1, 1]);
  });

  it('exports CSV for reports', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('a');
    await t.forecast('a', m.id, 'YES');
    const csv = await t.engine.exportHistoryCsv(m.id);
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe(
      'marketId,sequence,at,trigger,forecastId,openingBaseline,model,general,specialized,generalForecasters,specializedForecasters,generalAmount,specializedAmount,estimateRuleId,estimateKind',
    );
    expect(row).toContain(`${m.id},1,${T0.toISOString()},forecast,`);
  });

  it('rejects history for unknown markets', async () => {
    const t = setup();
    await expectCode(t.engine.getHistory('nope'), 'MARKET_NOT_FOUND');
  });
});

describe('selectHistory', () => {
  const series = Array.from({ length: 101 }, (_, i) => snap(i + 1, i, i / 100));

  it('filters by time range (inclusive)', () => {
    const out = selectHistory(series, { from: series[10]!.at, to: series[20]!.at });
    expect(out.map((s) => s.sequence)).toEqual(Array.from({ length: 11 }, (_, i) => i + 11));
  });

  it('downsamples to at most maxPoints, keeping first and last', () => {
    for (const maxPoints of [2, 3, 7, 50, 100]) {
      const out = selectHistory(series, { maxPoints });
      expect(out.length).toBeLessThanOrEqual(maxPoints);
      expect(out[0]).toBe(series[0]);
      expect(out.at(-1)).toBe(series.at(-1));
      const seqs = out.map((s) => s.sequence);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    }
    expect(selectHistory(series, { maxPoints: 500 })).toHaveLength(101);
  });

  it('validates queries', () => {
    expect(() => selectHistory(series, { maxPoints: 1 })).toThrow(/maxPoints/);
    expect(() => selectHistory(series, { from: series[5]!.at, to: series[1]!.at })).toThrow(/from/);
  });

  it('handles empty history', () => {
    expect(selectHistory([], { maxPoints: 5 })).toEqual([]);
    expect(snapshotAt([], T0)).toBeNull();
  });

  it('finds the snapshot in effect at a time', () => {
    expect(snapshotAt(series, new Date(T0.getTime() - 1))).toBeNull();
    expect(snapshotAt(series, new Date(T0.getTime() + 5.5 * 60_000))!.sequence).toBe(6);
    expect(snapshotAt(series, new Date(T0.getTime() + 999 * 60_000))!.sequence).toBe(101);
  });
});

describe('snapshotsToCsv', () => {
  it('escapes commas, quotes and newlines', () => {
    const s = { ...snap(1, 0), estimateRuleId: 'a,"b"\nc' };
    expect(snapshotsToCsv([s])).toContain('"a,""b""\nc"');
  });
});
