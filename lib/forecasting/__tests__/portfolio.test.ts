import { describe, expect, it } from 'vitest';
import { anonymous, asUser, DAY, expectCode, resolver, setup, T0 } from './helpers.js';

describe('getPortfolio', () => {
  it('groups positions and totals them, reading the balance from the ledger', async () => {
    const t = setup();
    for (const u of ['alice', 'bob']) await t.fund(u, 200);

    const active = await t.createMarket({ closesAt: new Date(T0.getTime() + 10 * DAY) });
    const awaiting = await t.createMarket({ closesAt: new Date(T0.getTime() + 2 * DAY) });
    const won = await t.createMarket({ closesAt: new Date(T0.getTime() + 1 * DAY) });
    const lost = await t.createMarket({ closesAt: new Date(T0.getTime() + 1 * DAY) });

    await t.forecast('alice', active.id, 'YES', 10);
    await t.forecast('bob', active.id, 'NO', 10);
    await t.forecast('alice', awaiting.id, 'NO', 20);
    await t.forecast('alice', won.id, 'YES', 30);
    await t.forecast('alice', lost.id, 'YES', 40);

    t.clock.set(new Date(T0.getTime() + 3 * DAY));
    const resolvedAt = t.clock.now();
    await t.engine.settleMarket(resolver, { marketId: won.id, outcome: 'YES', resolutionId: 'r1', resolvedAt });
    await t.engine.settleMarket(resolver, { marketId: lost.id, outcome: 'NO', resolutionId: 'r2', resolvedAt });

    const p = await t.engine.getPortfolio(asUser('alice'), 'alice');
    expect(p.balance).toBe(200 - 100 + 60);
    expect(p.unitLabel).toBe('credits');
    expect(p.active.map((x) => x.marketId)).toEqual([active.id]);
    expect(p.awaitingResolution.map((x) => x.marketId)).toEqual([awaiting.id]);
    expect(p.resolved.map((x) => [x.marketId, x.result, x.payout, x.net]).sort()).toEqual(
      [
        [won.id, 'won', 60, 30],
        [lost.id, 'lost', 0, -40],
      ].sort(),
    );
    expect(p.totals).toEqual({
      forecasts: 4,
      activeStake: 10,
      awaitingResolutionStake: 20,
      resolvedStake: 70,
      totalPayout: 60,
      netResult: -10,
      won: 1,
      lost: 1,
      void: 0,
    });

    // Active positions show the latest values next to the preserved entry values.
    const a = p.active[0]!;
    expect(a.entry.generalAfter).toBe(1);
    expect(a.current).toMatchObject({ general: 0.5, model: 0.4 });
    expect(a.result).toBe('pending');
    expect(p.resolved.every((x) => x.current === null)).toBe(true);

    // History is the ledger, newest first, annotated with the forecast and question.
    expect(p.history.map((h) => h.reason)).toEqual([
      'forecast_payout',
      'forecast_stake',
      'forecast_stake',
      'forecast_stake',
      'forecast_stake',
      'grant',
    ]);
    expect(p.history[0]).toMatchObject({ marketId: won.id, question: won.question, delta: 60 });
  });

  it('shows void results', async () => {
    const t = setup();
    await t.fund('alice', 50);
    const m = await t.createMarket();
    await t.forecast('alice', m.id, 'YES', 50);
    t.clock.set(m.closesAt);
    await t.engine.settleMarket(resolver, { marketId: m.id, outcome: 'VOID', resolutionId: 'r', resolvedAt: m.closesAt });
    const p = await t.engine.getPortfolio(asUser('alice'), 'alice');
    expect(p.resolved[0]).toMatchObject({ result: 'void', payout: 50, net: 0 });
    expect(p.balance).toBe(50);
    expect(p.totals.void).toBe(1);
  });

  it('works for a user with no activity', async () => {
    const t = setup();
    const p = await t.engine.getPortfolio(asUser('new'), 'new');
    expect(p).toMatchObject({ balance: 0, active: [], resolved: [], history: [] });
    expect(p.totals.forecasts).toBe(0);
  });

  it("doesn't let users see each other's portfolios", async () => {
    const t = setup();
    await expectCode(t.engine.getPortfolio(asUser('bob'), 'alice'), 'FORBIDDEN');
    await expectCode(t.engine.getPortfolio(anonymous, 'alice'), 'UNAUTHENTICATED');
  });
});
