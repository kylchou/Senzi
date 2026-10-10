import { describe, expect, it } from 'vitest';
import {
  createLmsrRule,
  createLmsrSettlement,
  liquidityFor,
  openingState,
  quoteTrade,
  replay,
  sharesForSpend,
  spendForShares,
  worstCaseLoss,
  yesPrice,
  type LmsrFill,
} from '../index';
import { asUser, expectCode, resolver, setup } from './helpers';

describe('LMSR math', () => {
  it('opens at the baseline, clamped to 5%-95%', () => {
    expect(yesPrice(openingState(0.4, 1700))).toBeCloseTo(0.4, 12);
    expect(yesPrice(openingState(0.01, 1700))).toBeCloseTo(0.05, 12);
    expect(yesPrice(openingState(0.999, 1700))).toBeCloseTo(0.95, 12);
    expect(openingState(0.4, 1700).qNo).toBe(0);
  });

  it('moves the price about 3 points for 100 credits at 50% with b = 1,700', () => {
    const q = quoteTrade(openingState(0.5, 1700), 'YES', 100);
    expect(q.priceAfter - q.priceBefore).toBeGreaterThan(0.025);
    expect(q.priceAfter - q.priceBefore).toBeLessThan(0.035);
    expect(q.averagePrice).toBeGreaterThan(0.5);
    expect(q.averagePrice).toBeLessThan(q.priceAfter);
  });

  it('sharesForSpend and spendForShares are inverses on both sides', () => {
    for (const s of [openingState(0.2, 1500), openingState(0.9, 400)]) {
      for (const side of ['YES', 'NO'] as const) {
        for (const c of [1, 50, 2000]) {
          expect(spendForShares(s, side, sharesForSpend(s, side, c))).toBeCloseTo(c, 8);
        }
      }
    }
  });

  it('is symmetric between YES and NO', () => {
    const yes = quoteTrade(openingState(0.3, 1700), 'YES', 250);
    const no = quoteTrade(openingState(0.7, 1700), 'NO', 250);
    expect(yes.shares).toBeCloseTo(no.shares, 9);
    expect(yes.priceAfter).toBeCloseTo(1 - no.priceAfter, 12);
  });

  it('never overflows for large q/b', () => {
    const s = { b: 10, qYes: 1e6, qNo: 2e5 };
    expect(yesPrice(s)).toBe(1);
    const x = sharesForSpend(s, 'NO', 100);
    expect(Number.isFinite(x)).toBe(true);
    expect(x).toBeGreaterThan(0);
    expect(Number.isFinite(sharesForSpend(s, 'YES', 5))).toBe(true);
  });

  it('computes the market maker worst case from the opening price', () => {
    expect(worstCaseLoss(0.5, 1700)).toBeCloseTo(1700 * Math.LN2, 9);
    expect(worstCaseLoss(0.2, 1000)).toBeCloseTo(1000 * Math.log(5), 9);
    expect(worstCaseLoss(0.01, 1000)).toBeCloseTo(1000 * Math.log(20), 9); // clamped to 5%
  });

  it('scales b with the starting balance and lowers it for low-confidence baselines', () => {
    expect(liquidityFor({ startingBalance: 1000, lowConfidence: false })).toBe(1700);
    expect(liquidityFor({ startingBalance: 2000, lowConfidence: false })).toBe(3400);
    expect(liquidityFor({ startingBalance: 1000, lowConfidence: true })).toBeCloseTo(1020, 9);
  });

  it('replays trades the same way as quoting them one by one', () => {
    let s = openingState(0.4, 1700);
    for (const t of [{ side: 'YES', credits: 100 }, { side: 'NO', credits: 300 }, { side: 'YES', credits: 40 }] as const) {
      s = quoteTrade(s, t.side, t.credits).stateAfter;
    }
    const r = replay(0.4, 1700, [{ side: 'YES', credits: 100 }, { side: 'NO', credits: 300 }, { side: 'YES', credits: 40 }]);
    expect(r.qYes).toBeCloseTo(s.qYes, 9);
    expect(r.qNo).toBeCloseTo(s.qNo, 9);
  });
});

const lmsrSetup = (extra: Parameters<typeof setup>[0] = {}) =>
  setup({ estimateRule: createLmsrRule(), settlementModel: createLmsrSettlement(), ...extra });

describe('engine on LMSR', () => {
  it('records fills, moves the general line, and replays only verified trades for the specialized line', async () => {
    const t = lmsrSetup();
    const m = await t.createMarket({ lmsrB: 1700 });
    t.traders.verify('vera', 'acme');
    for (const u of ['vera', 'gus']) await t.fund(u, 1000);

    const r1 = await t.forecast('vera', m.id, 'YES', 200);
    const fill = r1.fill as LmsrFill;
    expect(fill.b).toBe(1700);
    expect(fill.priceBefore).toBeCloseTo(0.4, 12);
    expect(fill.shares).toBeGreaterThan(200); // bought below 1 credit per share
    expect(r1.entry.generalAfter).toBeCloseTo(fill.priceAfter, 12);
    expect(r1.entry.estimateKind).toBe('market_price');

    await t.forecast('gus', m.id, 'NO', 500);
    const e = await t.engine.getMarketEstimates(m.id);
    expect(e.general.label).toBe('Market probability (all users)');
    expect(e.specialized.label).toBe('Market probability (verified users)');
    // Verified line only saw vera's YES trade.
    expect(e.specialized.value).toBeCloseTo(fill.priceAfter, 12);
    expect(e.general.value!).toBeLessThan(e.specialized.value!);
    expect(e.general.value).toBeCloseTo(yesPrice(replay(0.4, 1700, [{ side: 'YES', credits: 200 }, { side: 'NO', credits: 500 }])), 12);
  });

  it('freezes b at the first trade', async () => {
    const t = lmsrSetup();
    const m = await t.createMarket({ lmsrB: 1700 });
    await t.fund('a');
    await t.forecast('a', m.id, 'YES', 100);
    await t.repo.saveMarket({ ...(await t.repo.getMarket(m.id))!, lmsrB: 50 });
    const r = await t.forecast('a', m.id, 'YES', 100);
    expect((r.fill as LmsrFill).b).toBe(1700);
  });

  it('quotes without trading and rejects a trade whose price moved past the tolerance', async () => {
    const t = lmsrSetup();
    const m = await t.createMarket({ lmsrB: 1700 });
    for (const u of ['a', 'b']) await t.fund(u, 5000);

    const q = await t.engine.quoteForecast({ marketId: m.id, side: 'YES', amount: 100 });
    expect(q.fill.priceBefore).toBeCloseTo(0.4, 12);
    expect(await t.repo.listForecastsByMarket(m.id)).toHaveLength(0);

    await t.forecast('b', m.id, 'YES', 3000); // someone else moves the price a lot
    const err = await expectCode(
      t.engine.submitForecast(asUser('a'), { marketId: m.id, side: 'YES', amount: 100, idempotencyKey: 'k-a', quotedPrice: q.fill.priceBefore! }),
      'PRICE_MOVED',
    );
    expect(err.details?.currentPrice as number).toBeGreaterThan(0.45);
    expect((err.details?.quote as LmsrFill).shares).toBeGreaterThan(0);
    expect(await t.ledger.getBalance('a')).toBe(5000);

    // Within tolerance it goes through.
    const fresh = await t.engine.quoteForecast({ marketId: m.id, side: 'YES', amount: 100 });
    await t.engine.submitForecast(asUser('a'), { marketId: m.id, side: 'YES', amount: 100, idempotencyKey: 'k-a2', quotedPrice: fresh.fill.priceBefore! + 0.01 });
  });

  it('refuses to trade a market without an opening price', async () => {
    const t = lmsrSetup();
    const m = await t.createMarket({ openingBaseline: null, model: null });
    await t.fund('a');
    await expectCode(t.forecast('a', m.id, 'YES', 10), 'MARKET_NOT_OPEN');
    await expectCode(t.engine.quoteForecast({ marketId: m.id, side: 'YES', amount: 10 }), 'MARKET_NOT_OPEN');
  });

  it('pays winners 1 credit per share (rounded down) and keeps the ledger balanced through the market maker', async () => {
    const t = lmsrSetup({ marketMakerAccountId: 'mm' });
    const m = await t.createMarket({ lmsrB: 300 });
    for (const u of ['yes1', 'yes2', 'no1']) await t.fund(u, 1000);
    const y1 = await t.forecast('yes1', m.id, 'YES', 400);
    const y2 = await t.forecast('yes2', m.id, 'YES', 300);
    await t.forecast('no1', m.id, 'NO', 200);
    expect(await t.ledger.getBalance('mm')).toBe(900); // all stakes

    t.clock.set(m.closesAt);
    const { record } = await t.engine.settleMarket(resolver, { marketId: m.id, outcome: 'YES', resolutionId: 'r1', resolvedAt: m.closesAt });
    const expected1 = Math.floor((y1.fill as LmsrFill).shares);
    const expected2 = Math.floor((y2.fill as LmsrFill).shares);
    expect(record.payouts.map((p) => p.payout)).toEqual([expected1, expected2, 0]);
    expect(await t.ledger.getBalance('yes1')).toBe(600 + expected1);
    expect(await t.ledger.getBalance('no1')).toBe(800);

    // Shortfall was minted to the market maker; it ends at zero, nobody else is affected.
    const minted = expected1 + expected2 - 900;
    expect(minted).toBeGreaterThan(0);
    expect(minted).toBeLessThanOrEqual(worstCaseLoss(0.4, 300));
    expect(await t.ledger.getBalance('mm')).toBe(0);
    const mmTx = await t.ledger.listTransactions('mm');
    expect(mmTx.filter((x) => x.reason === 'market_maker_mint').map((x) => x.delta)).toEqual([minted]);

    // Total credits = grants + minted subsidy.
    const total = (await Promise.all(['yes1', 'yes2', 'no1', 'mm'].map((u) => t.ledger.getBalance(u)))).reduce((a, b) => a + b, 0);
    expect(total).toBe(3000 + minted);
  });

  it('refunds exactly what each trader spent on VOID, paid back by the market maker', async () => {
    const t = lmsrSetup({ marketMakerAccountId: 'mm' });
    const m = await t.createMarket({ lmsrB: 300 });
    for (const u of ['a', 'b']) await t.fund(u, 1000);
    await t.forecast('a', m.id, 'YES', 400);
    await t.forecast('b', m.id, 'NO', 150);
    t.clock.set(m.closesAt);
    await t.engine.settleMarket(resolver, { marketId: m.id, outcome: 'VOID', resolutionId: 'r', resolvedAt: m.closesAt });
    expect(await t.ledger.getBalance('a')).toBe(1000);
    expect(await t.ledger.getBalance('b')).toBe(1000);
    expect(await t.ledger.getBalance('mm')).toBe(0);
    expect((await t.ledger.listTransactions('mm')).some((x) => x.reason === 'market_maker_mint')).toBe(false);
  });
});
