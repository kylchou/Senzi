import { describe, expect, it } from 'vitest';
import { InMemoryCreditLedger, type SettlementModel } from '../index.js';
import { asUser, DAY, expectCode, modelService, resolver, setup, T0 } from './helpers.js';

async function marketWithForecasts(t: ReturnType<typeof setup>) {
  const m = await t.createMarket();
  for (const u of ['yes1', 'yes2', 'no1']) await t.fund(u, 100);
  await t.forecast('yes1', m.id, 'YES', 10);
  await t.forecast('yes2', m.id, 'YES', 30);
  await t.forecast('no1', m.id, 'NO', 20);
  t.clock.set(new Date(m.closesAt.getTime() + 1));
  return m;
}

const settleInput = (marketId: string, outcome: 'YES' | 'NO' | 'VOID' = 'YES', resolutionId = 'res-1') => ({
  marketId,
  outcome,
  resolutionId,
  resolvedAt: new Date(T0.getTime() + 8 * DAY),
});

describe('settleMarket: authorization and preconditions', () => {
  it('only the authorized resolution workflow may settle', async () => {
    const t = setup();
    const m = await marketWithForecasts(t);
    await expectCode(t.engine.settleMarket(asUser('sponsor-1'), settleInput(m.id)), 'FORBIDDEN');
    await expectCode(t.engine.settleMarket(modelService, settleInput(m.id)), 'FORBIDDEN');
    await expectCode(t.engine.settleMarket({ kind: 'anonymous' }, settleInput(m.id)), 'FORBIDDEN');
  });

  it('validates input', async () => {
    const t = setup();
    const m = await marketWithForecasts(t);
    await expectCode(t.engine.settleMarket(resolver, { ...settleInput(m.id), outcome: 'MAYBE' as never }), 'VALIDATION_FAILED');
    await expectCode(t.engine.settleMarket(resolver, { ...settleInput(m.id), resolutionId: '' }), 'VALIDATION_FAILED');
    await expectCode(t.engine.settleMarket(resolver, { ...settleInput(m.id), resolvedAt: new Date('bad') }), 'VALIDATION_FAILED');
  });

  it('refuses before the deadline and for markets that never opened', async () => {
    const t = setup();
    const open = await t.createMarket();
    await expectCode(t.engine.settleMarket(resolver, settleInput(open.id)), 'SETTLEMENT_NOT_ALLOWED');
    const pending = await t.createMarket({ status: 'pending_quorum' });
    t.clock.set(new Date(pending.closesAt.getTime() + 1));
    await expectCode(t.engine.settleMarket(resolver, settleInput(pending.id)), 'SETTLEMENT_NOT_ALLOWED');
    const cancelled = await t.createMarket({ status: 'cancelled' });
    await expectCode(t.engine.settleMarket(resolver, settleInput(cancelled.id)), 'SETTLEMENT_NOT_ALLOWED');
    await expectCode(t.engine.settleMarket(resolver, settleInput('missing')), 'MARKET_NOT_FOUND');
  });
});

describe('settleMarket: applying outcomes', () => {
  it('pays out through the ledger and resolves the market', async () => {
    const t = setup();
    const m = await marketWithForecasts(t);
    const { record, alreadySettled } = await t.engine.settleMarket(resolver, settleInput(m.id, 'YES'));

    expect(alreadySettled).toBe(false);
    expect(record).toMatchObject({ status: 'completed', outcome: 'YES', settlementModelId: 'test-double-or-nothing', requestedBy: 'resolution-workflow' });
    expect(record.payouts.map((p) => [p.userId, p.stake, p.payout, p.net])).toEqual([
      ['yes1', 10, 20, 10],
      ['yes2', 30, 60, 30],
      ['no1', 20, 0, -20],
    ]);
    expect(record.payouts.find((p) => p.userId === 'no1')!.ledgerTransactionId).toBeNull();
    expect(await t.ledger.getBalance('yes1')).toBe(110);
    expect(await t.ledger.getBalance('yes2')).toBe(130);
    expect(await t.ledger.getBalance('no1')).toBe(80);
    expect((await t.repo.getMarket(m.id))!.status).toBe('resolved');
    expect((await t.repo.listSnapshots(m.id)).at(-1)!.trigger).toBe('settlement');
  });

  it('is idempotent: repeated calls return the stored result and pay nothing more', async () => {
    const t = setup();
    const m = await marketWithForecasts(t);
    const first = await t.engine.settleMarket(resolver, settleInput(m.id));
    const second = await t.engine.settleMarket(resolver, settleInput(m.id));
    expect(second.alreadySettled).toBe(true);
    expect(second.record).toEqual(first.record);
    expect(await t.ledger.getBalance('yes1')).toBe(110);
    expect((await t.repo.listSnapshots(m.id)).filter((s) => s.trigger === 'settlement')).toHaveLength(1);
  });

  it('rejects a conflicting outcome or resolution id after settlement', async () => {
    const t = setup();
    const m = await marketWithForecasts(t);
    await t.engine.settleMarket(resolver, settleInput(m.id, 'YES'));
    await expectCode(t.engine.settleMarket(resolver, settleInput(m.id, 'NO')), 'SETTLEMENT_CONFLICT');
    await expectCode(t.engine.settleMarket(resolver, settleInput(m.id, 'YES', 'res-2')), 'SETTLEMENT_CONFLICT');
  });

  it('settles exactly once under concurrent calls', async () => {
    const t = setup();
    const m = await marketWithForecasts(t);
    const results = await Promise.all(Array.from({ length: 10 }, () => t.engine.settleMarket(resolver, settleInput(m.id))));
    expect(results.filter((r) => !r.alreadySettled)).toHaveLength(1);
    expect(await t.ledger.getBalance('yes2')).toBe(130);
  });

  it('refunds stakes on VOID without needing a settlement model', async () => {
    const t = setup({ settlementModel: undefined });
    const m = await marketWithForecasts(t);
    const { record } = await t.engine.settleMarket(resolver, settleInput(m.id, 'VOID'));
    expect(record.settlementModelId).toBe('void-refund');
    expect(record.payouts.every((p) => p.payout === p.stake && p.net === 0)).toBe(true);
    for (const u of ['yes1', 'yes2', 'no1']) expect(await t.ledger.getBalance(u)).toBe(100);
  });

  it('fails clearly for YES/NO when no settlement model is configured, leaving no partial state', async () => {
    const t = setup({ settlementModel: undefined });
    const m = await marketWithForecasts(t);
    await expectCode(t.engine.settleMarket(resolver, settleInput(m.id)), 'NOT_CONFIGURED');
    expect(await t.repo.getSettlement(m.id)).toBeNull();
    expect((await t.repo.getMarket(m.id))!.status).toBe('open');
  });

  it('settles a market with no forecasts', async () => {
    const t = setup();
    const m = await t.createMarket();
    t.clock.set(new Date(m.closesAt.getTime()));
    const { record } = await t.engine.settleMarket(resolver, settleInput(m.id, 'NO'));
    expect(record.payouts).toEqual([]);
    expect(record.status).toBe('completed');
  });

  it('blocks forecasts after settlement', async () => {
    const t = setup();
    const m = await marketWithForecasts(t);
    await t.engine.settleMarket(resolver, settleInput(m.id));
    await expectCode(t.forecast('yes1', m.id, 'YES'), 'MARKET_NOT_OPEN');
  });
});

describe('settleMarket: settlement model validation', () => {
  const cases: Array<[string, SettlementModel['computePayouts']]> = [
    ['skips a forecast', ({ forecasts }) => forecasts.slice(1).map((f) => ({ forecastId: f.id, payout: 1 }))],
    ['pays a forecast twice', ({ forecasts }) => [...forecasts, forecasts[0]!].map((f) => ({ forecastId: f.id, payout: 1 }))],
    ['returns a negative payout', ({ forecasts }) => forecasts.map((f) => ({ forecastId: f.id, payout: -1 }))],
    ['returns a fractional payout', ({ forecasts }) => forecasts.map((f) => ({ forecastId: f.id, payout: 1.5 }))],
    ['pays an unknown forecast', ({ forecasts }) => [...forecasts.map((f) => ({ forecastId: f.id, payout: 1 })), { forecastId: 'ghost', payout: 1 }]],
  ];

  it.each(cases)('rejects a model that %s, before paying anyone', async (_name, computePayouts) => {
    const t = setup({ settlementModel: { id: 'broken', computePayouts } });
    const m = await marketWithForecasts(t);
    await expectCode(t.engine.settleMarket(resolver, settleInput(m.id)), 'INVARIANT_VIOLATION');
    expect(await t.repo.getSettlement(m.id)).toBeNull();
    expect(await t.ledger.getBalance('yes1')).toBe(90);
  });
});

describe('settleMarket: crash recovery', () => {
  it('resumes a partially applied settlement without double paying', async () => {
    const t = setup();
    // A ledger that fails the second payout credit once.
    const ledger = t.ledger as InMemoryCreditLedger;
    const realCredit = ledger.credit.bind(ledger);
    let payoutCalls = 0;
    ledger.credit = async (req) => {
      if (req.reason === 'forecast_payout' && ++payoutCalls === 2) throw new Error('ledger timeout');
      return realCredit(req);
    };

    const m = await marketWithForecasts(t);
    await expect(t.engine.settleMarket(resolver, settleInput(m.id))).rejects.toThrow('ledger timeout');
    const partial = await t.repo.getSettlement(m.id);
    expect(partial!.status).toBe('in_progress');
    expect(await t.ledger.getBalance('yes1')).toBe(110);
    expect(await t.ledger.getBalance('yes2')).toBe(70);
    expect((await t.repo.getMarket(m.id))!.status).toBe('open');

    // A conflicting retry is still rejected while in progress.
    await expectCode(t.engine.settleMarket(resolver, settleInput(m.id, 'NO')), 'SETTLEMENT_CONFLICT');

    const resumed = await t.engine.settleMarket(resolver, settleInput(m.id));
    expect(resumed.alreadySettled).toBe(false);
    expect(resumed.record.status).toBe('completed');
    expect(await t.ledger.getBalance('yes1')).toBe(110);
    expect(await t.ledger.getBalance('yes2')).toBe(130);
    const payoutTxs = (await t.ledger.listTransactions('yes1')).filter((x) => x.reason === 'forecast_payout');
    expect(payoutTxs).toHaveLength(1);
  });

  it('a retry with a lost ledger response does not pay twice (ledger idempotency)', async () => {
    const t = setup();
    const ledger = t.ledger as InMemoryCreditLedger;
    const realCredit = ledger.credit.bind(ledger);
    let failed = false;
    ledger.credit = async (req) => {
      const tx = await realCredit(req);
      if (!failed && req.reason === 'forecast_payout') {
        failed = true;
        throw new Error('response lost'); // credit applied, caller never hears back
      }
      return tx;
    };
    const m = await marketWithForecasts(t);
    await expect(t.engine.settleMarket(resolver, settleInput(m.id))).rejects.toThrow('response lost');
    await t.engine.settleMarket(resolver, settleInput(m.id));
    expect(await t.ledger.getBalance('yes1')).toBe(110);
    expect(await t.ledger.getBalance('yes2')).toBe(130);
  });
});
