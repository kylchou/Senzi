import { describe, expect, it } from 'vitest';
import { resolver, setup, T0 } from './helpers.js';

type T = ReturnType<typeof setup>;

let settleCount = 0;

async function settle(t: T, marketId: string, outcome: 'YES' | 'NO' | 'VOID') {
  const m = (await t.repo.getMarket(marketId))!;
  // Distinct settlement times so resolution order (streaks) is well defined.
  t.clock.set(new Date(m.closesAt.getTime() + ++settleCount * 1000));
  await t.engine.settleMarket(resolver, { marketId, outcome, resolutionId: `r-${marketId}`, resolvedAt: t.clock.now() });
}

/** Creates a market, places forecasts at T0 (sides in order), and settles it. */
async function playMarket(t: T, sides: Array<[user: string, side: 'YES' | 'NO']>, outcome: 'YES' | 'NO' | 'VOID') {
  t.clock.set(T0);
  const m = await t.createMarket();
  for (const [u, side] of sides) await t.forecast(u, m.id, side);
  await settle(t, m.id, outcome);
  return m;
}

describe('getUserStats', () => {
  it('computes accuracy, streaks, results and achievements', async () => {
    const t = setup();
    for (const u of ['alice', 'bob']) await t.fund(u, 10_000);

    // alice: W W W L W W  (first win placed against the crowd), then one void
    await playMarket(t, [['bob', 'NO'], ['alice', 'YES']], 'YES');
    await playMarket(t, [['alice', 'YES']], 'YES');
    await playMarket(t, [['alice', 'NO']], 'NO');
    await playMarket(t, [['alice', 'YES']], 'NO');
    await playMarket(t, [['alice', 'NO']], 'NO');
    await playMarket(t, [['alice', 'YES']], 'YES');
    await playMarket(t, [['alice', 'YES']], 'VOID');

    const s = await t.engine.getUserStats('alice');
    expect(s).toMatchObject({
      forecasts: 7,
      marketsForecast: 7,
      resolvedForecasts: 6,
      voidForecasts: 1,
      correct: 5,
      currentStreak: 2,
      bestStreak: 3,
      totalStaked: 70,
      averageStake: 10,
      netResult: 5 * 10 - 10,
      limitations: [],
    });
    expect(s.accuracy).toBeCloseTo(5 / 6);
    expect(s.stakeWeightedAccuracy).toBeCloseTo(5 / 6);
    const [lo, hi] = s.accuracyInterval!;
    expect(lo).toBeLessThan(5 / 6);
    expect(hi).toBeGreaterThan(5 / 6);
    expect(s.achievements.map((a) => a.id).sort()).toEqual(
      ['against_the_crowd', 'early_and_right', 'first_correct', 'first_forecast', 'five_correct', 'streak_three'].sort(),
    );
  });

  it('explains small samples and empty histories', async () => {
    const t = setup();
    await t.fund('alice');
    expect((await t.engine.getUserStats('nobody')).limitations).toEqual([
      'No resolved forecasts yet, so accuracy is not available.',
    ]);
    await playMarket(t, [['alice', 'YES']], 'YES');
    const s = await t.engine.getUserStats('alice');
    expect(s.accuracy).toBe(1);
    expect(s.limitations[0]).toMatch(/Only 1 resolved forecast; accuracy is not meaningful below 5/);
  });

  it('awards verified_voice and ten_forecasts', async () => {
    const t = setup();
    t.traders.verify('vera', 'acme');
    await t.fund('vera');
    const m = await t.createMarket();
    for (let i = 0; i < 10; i++) await t.forecast('vera', m.id, 'YES');
    const ids = (await t.engine.getUserStats('vera')).achievements.map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(['verified_voice', 'ten_forecasts', 'first_forecast']));
  });
});

describe('getLeaderboard', () => {
  async function scenario() {
    const t = setup();
    for (const u of ['ann', 'ben', 'cat', 'dan']) await t.fund(u, 10_000);
    // ann and ben tie on net result; cat loses; dan never resolves.
    await playMarket(t, [['ann', 'YES'], ['ben', 'YES'], ['cat', 'NO']], 'YES');
    t.clock.set(T0);
    await t.createMarket().then((m) => t.forecast('dan', m.id, 'YES'));
    return t;
  }

  it('ranks by net result with shared ranks for ties, listing unranked users last', async () => {
    const t = await scenario();
    const lb = await t.engine.getLeaderboard();
    expect(lb.entries.map((e) => [e.rank, e.userId, e.value])).toEqual([
      [1, 'ann', 10],
      [1, 'ben', 10],
      [3, 'cat', -10],
      [null, 'dan', null],
    ]);
    expect(lb.limitations.join(' ')).toMatch(/1 resolved market/);
    expect(lb.limitations.join(' ')).toMatch(/settlement model/);
  });

  it('only ranks accuracy for users with enough resolved forecasts', async () => {
    const t = await scenario();
    const lb = await t.engine.getLeaderboard({ metric: 'accuracy' });
    expect(lb.entries.every((e) => e.rank === null)).toBe(true);
    expect(lb.entries[0]!.note).toMatch(/Needs 5 resolved forecasts/);

    const t2 = setup({ config: { leaderboard: { minResolvedForAccuracyRank: 1 } } });
    for (const u of ['ann', 'cat']) await t2.fund(u);
    await playMarket(t2, [['ann', 'YES'], ['cat', 'NO']], 'YES');
    const lb2 = await t2.engine.getLeaderboard({ metric: 'accuracy', limit: 1 });
    expect(lb2.entries).toHaveLength(1);
    expect(lb2.entries[0]).toMatchObject({ rank: 1, userId: 'ann', value: 1 });
  });

  it('handles an empty platform', async () => {
    const t = setup();
    const lb = await t.engine.getLeaderboard();
    expect(lb.entries).toEqual([]);
  });
});

describe('calibration', () => {
  /** 20 markets at a 25% share (5 resolve YES) and 20 at 75% (15 resolve YES). */
  async function wellCalibratedPlatform() {
    const t = setup();
    for (const u of ['u0', 'u1', 'u2', 'u3']) await t.fund(u, 1_000_000);
    for (const [yesCount, yesOutcomes] of [[1, 5], [3, 15]] as const) {
      for (let i = 0; i < 20; i++) {
        const sides = ['u0', 'u1', 'u2', 'u3'].map((u, j) => [u, j < yesCount ? 'YES' : 'NO'] as [string, 'YES' | 'NO']);
        await playMarket(t, sides, i < yesOutcomes ? 'YES' : 'NO');
      }
    }
    return t;
  }

  it('reports insufficient data with explicit limitations', async () => {
    const t = setup();
    await t.fund('a');
    await t.fund('b');
    await playMarket(t, [['a', 'YES']], 'YES');
    await playMarket(t, [['b', 'NO']], 'NO');
    await playMarket(t, [['a', 'YES']], 'VOID');

    const r = await t.engine.getCalibrationReport('general');
    expect(r).toMatchObject({ resolvedMarkets: 2, sufficient: false, estimateRuleId: 'test-count-share' });
    expect(r.excluded.void).toBe(1);
    expect(r.brierScore).toBe(0);
    expect(r.limitations.join(' ')).toMatch(/Only 2 resolved markets; at least 30/);
    expect(r.limitations.join(' ')).toMatch(/fewer than 5 markets/);
    expect(r.limitations.join(' ')).toMatch(/1 voided market/);

    const e = await t.engine.getMarketEstimates((await t.repo.listMarkets())[0]!.id);
    expect(e.general.isCalibratedProbability).toBe(false);
  });

  it('reports no data cleanly', async () => {
    const t = setup();
    const r = await t.engine.getCalibrationReport('model');
    expect(r).toMatchObject({ resolvedMarkets: 0, brierScore: null, expectedCalibrationError: null, baseRate: null });
    expect(r.limitations).toEqual(['No resolved markets with an estimate for this line yet.']);
  });

  it('labels the community line as calibrated only once evidence supports it', async () => {
    const t = await wellCalibratedPlatform();
    const general = await t.engine.getCalibrationReport('general');
    expect(general.resolvedMarkets).toBe(40);
    expect(general.sufficient).toBe(true);
    expect(general.expectedCalibrationError).toBeCloseTo(0);
    expect(general.brierScore).toBeCloseTo(0.1875);
    expect(general.baseRate).toBe(0.5);
    expect(general.baseRateBrierScore).toBeCloseTo(0.25);
    const filled = general.bins.filter((b) => b.count > 0);
    expect(filled.map((b) => [b.count, b.meanPredicted, b.observedRate])).toEqual([
      [20, 0.25, 0.25],
      [20, 0.75, 0.75],
    ]);

    // The model sat at 40% everywhere while half resolved YES: worse calibration.
    const model = await t.engine.getCalibrationReport('model');
    expect(model.expectedCalibrationError).toBeCloseTo(0.1);

    t.clock.set(T0);
    const open = await t.createMarket();
    await t.forecast('u0', open.id, 'YES');
    const e = await t.engine.getMarketEstimates(open.id);
    expect(e.general.isCalibratedProbability).toBe(true);
    expect(e.general.label).toBe('Community probability, all forecasters (calibrated on 40 resolved markets)');
    // No verified forecasts anywhere, so the specialized line stays unlabeled.
    expect(e.specialized.isCalibratedProbability).toBe(false);
  });

  it('does not count markets priced under a different rule', async () => {
    const t = await wellCalibratedPlatform();
    const t2 = setup({
      repo: t.repo,
      ledger: t.ledger,
      clock: t.clock,
      estimateRule: { id: 'another-rule', kind: 'market_price', compute: () => 0.5 },
    });
    const r = await t2.engine.getCalibrationReport('general');
    expect(r.resolvedMarkets).toBe(0);
    expect(r.excluded.differentRule).toBe(40);
  });
});
