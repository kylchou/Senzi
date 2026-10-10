import { describe, expect, it } from 'vitest';
import type { ForecastRepository } from '../index.js';
import { anonymous, asUser, DAY, expectCode, modelService, setup, T0 } from './helpers.js';

describe('submitForecast: happy path', () => {
  it('accepts a forecast, debits the ledger and returns an authoritative receipt', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('alice', 100);

    const r = await t.forecast('alice', m.id, 'YES', 30, 'key-1');

    expect(r).toMatchObject({
      marketId: m.id,
      userId: 'alice',
      side: 'YES',
      amount: 30,
      unitLabel: 'credits',
      sequence: 1,
      verifiedAtEntry: false,
      balanceAfter: 70,
      replayed: false,
      fill: { priorForecasts: 0 },
    });
    expect(r.receiptId).toBe(`rcpt_${r.forecastId}`);
    expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(r.acceptedAt).toEqual(T0);
    expect(r.entry).toMatchObject({
      openingBaseline: 0.4,
      model: 0.4,
      modelVersion: 'model-v0',
      generalBefore: null,
      generalAfter: 1,
      specializedBefore: null,
      specializedAfter: null,
      estimateRuleId: 'test-count-share',
      estimateKind: 'allocation_share',
    });
    expect(await t.ledger.getBalance('alice')).toBe(70);
    const txs = await t.ledger.listTransactions('alice');
    expect(txs.find((x) => x.id === r.ledgerTransactionId)).toMatchObject({ delta: -30, reference: r.forecastId });
    expect(await t.repo.listSnapshots(m.id)).toHaveLength(1);
  });

  it('records verified status and moves the specialized line only for verified users', async () => {
    const t = setup();
    const m = await t.createMarket();
    t.traders.verify('vera', 'acme');
    await t.fund('vera');
    await t.fund('gus');

    const v = await t.forecast('vera', m.id, 'YES');
    const g = await t.forecast('gus', m.id, 'NO');

    expect(v.verifiedAtEntry).toBe(true);
    expect(v.entry.specializedAfter).toBe(1);
    expect(g.verifiedAtEntry).toBe(false);
    expect(g.entry.specializedBefore).toBe(1);
    expect(g.entry.specializedAfter).toBe(1);
    expect(g.entry.generalAfter).toBe(0.5);
  });

  it('allows several forecasts per user on the same market with different keys', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('alice');
    const a = await t.forecast('alice', m.id, 'YES');
    const b = await t.forecast('alice', m.id, 'NO');
    expect([a.sequence, b.sequence]).toEqual([1, 2]);
  });
});

describe('submitForecast: validation and auth', () => {
  it.each([
    [{ side: 'MAYBE' }, 'side'],
    [{ amount: 0 }, 'amount'],
    [{ amount: -5 }, 'amount'],
    [{ amount: 1.5 }, 'amount'],
    [{ amount: Number.NaN }, 'amount'],
    [{ amount: '10' }, 'amount'],
    [{ idempotencyKey: '' }, 'idempotencyKey'],
    [{ idempotencyKey: 'x'.repeat(129) }, 'idempotencyKey'],
    [{ marketId: '  ' }, 'marketId'],
  ])('rejects %j', async (patch, field) => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('alice');
    const input = { marketId: m.id, side: 'YES', amount: 10, idempotencyKey: 'k', ...patch };
    const err = await expectCode(t.engine.submitForecast(asUser('alice'), input as never), 'VALIDATION_FAILED');
    expect(err.details?.field).toBe(field);
  });

  it('requires a signed-in user', async () => {
    const t = setup();
    const m = await t.createMarket();
    const input = { marketId: m.id, side: 'YES' as const, amount: 10, idempotencyKey: 'k' };
    await expectCode(t.engine.submitForecast(anonymous, input), 'UNAUTHENTICATED');
    await expectCode(t.engine.submitForecast(modelService, input), 'UNAUTHENTICATED');
    await expectCode(t.engine.submitForecast(asUser(''), input), 'UNAUTHENTICATED');
  });

  it('fails clearly when no pricing rule is configured', async () => {
    const t = setup({ estimateRule: undefined });
    const m = await t.createMarket();
    await t.fund('alice');
    await expectCode(t.forecast('alice', m.id, 'YES'), 'NOT_CONFIGURED');
    expect(await t.ledger.getBalance('alice')).toBe(1000);
  });
});

describe('submitForecast: market status and deadlines', () => {
  it('rejects unknown markets', async () => {
    const t = setup();
    await t.fund('alice');
    await expectCode(t.forecast('alice', 'nope', 'YES'), 'MARKET_NOT_FOUND');
  });

  it.each(['pending_quorum', 'closed', 'resolved', 'cancelled'] as const)('rejects %s markets', async (status) => {
    const t = setup();
    const m = await t.createMarket({ status });
    await t.fund('alice');
    const err = await expectCode(t.forecast('alice', m.id, 'YES'), 'MARKET_NOT_OPEN');
    expect(err.details?.status).toBe(status);
  });

  it('rejects forecasts before opensAt', async () => {
    const t = setup();
    const m = await t.createMarket({ opensAt: new Date(T0.getTime() + DAY) });
    await t.fund('alice');
    await expectCode(t.forecast('alice', m.id, 'YES'), 'MARKET_NOT_STARTED');
  });

  it('rejects forecasts at or after the deadline, accepts one just before', async () => {
    const t = setup();
    const m = await t.createMarket({ closesAt: new Date(T0.getTime() + 1000) });
    await t.fund('alice');
    t.clock.set(new Date(T0.getTime() + 999));
    await t.forecast('alice', m.id, 'YES');
    t.clock.set(new Date(T0.getTime() + 1000));
    await expectCode(t.forecast('alice', m.id, 'YES'), 'DEADLINE_PASSED');
  });

  it('enforces per-market amount limits', async () => {
    const t = setup();
    const m = await t.createMarket({ minAmount: 5, maxAmount: 50 });
    await t.fund('alice');
    await expectCode(t.forecast('alice', m.id, 'YES', 4), 'VALIDATION_FAILED');
    await expectCode(t.forecast('alice', m.id, 'YES', 51), 'VALIDATION_FAILED');
    await t.forecast('alice', m.id, 'YES', 50);
  });
});

describe('submitForecast: eligibility and balance', () => {
  it('bars the sponsor from their own market', async () => {
    const t = setup();
    const m = await t.createMarket({ sponsorId: 'vc' });
    await t.fund('vc');
    const err = await expectCode(t.forecast('vc', m.id, 'YES'), 'NOT_ELIGIBLE');
    expect(err.details?.reason).toBe('SPONSOR_OF_MARKET');
  });

  it('bars users with a declared conflict of interest, even if verified', async () => {
    const t = setup();
    const m = await t.createMarket();
    t.traders.verify('emp', 'acme');
    t.traders.declareConflict('emp', 'acme');
    await t.fund('emp');
    const err = await expectCode(t.forecast('emp', m.id, 'YES'), 'NOT_ELIGIBLE');
    expect(err.details?.reason).toBe('CONFLICT_OF_INTEREST');
  });

  it('can require verification when configured', async () => {
    const t = setup({ config: { requireVerifiedTrader: true } });
    const m = await t.createMarket();
    await t.fund('gus');
    const err = await expectCode(t.forecast('gus', m.id, 'YES'), 'NOT_ELIGIBLE');
    expect(err.details?.reason).toBe('NOT_VERIFIED');
    t.traders.verify('gus', 'acme');
    await t.forecast('gus', m.id, 'YES');
  });

  it('rejects when the balance is too low and leaves no trace', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('alice', 5);
    await expectCode(t.forecast('alice', m.id, 'YES', 10), 'INSUFFICIENT_BALANCE');
    expect(await t.ledger.getBalance('alice')).toBe(5);
    expect(await t.repo.listForecastsByMarket(m.id)).toHaveLength(0);
    expect(await t.repo.listSnapshots(m.id)).toHaveLength(0);
  });
});

describe('submitForecast: duplicates and concurrency', () => {
  it('replays the original receipt for a retried request', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('alice', 100);
    const first = await t.forecast('alice', m.id, 'YES', 10, 'same');
    const again = await t.forecast('alice', m.id, 'YES', 10, 'same');
    expect(again.replayed).toBe(true);
    expect({ ...again, replayed: false }).toEqual(first);
    expect(await t.ledger.getBalance('alice')).toBe(90);
  });

  it('rejects a reused key with a different payload', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('alice', 100);
    await t.forecast('alice', m.id, 'YES', 10, 'same');
    await expectCode(t.forecast('alice', m.id, 'NO', 10, 'same'), 'IDEMPOTENCY_CONFLICT');
    await expectCode(t.forecast('alice', m.id, 'YES', 11, 'same'), 'IDEMPOTENCY_CONFLICT');
    const m2 = await t.createMarket();
    await expectCode(t.forecast('alice', m2.id, 'YES', 10, 'same'), 'IDEMPOTENCY_CONFLICT');
    expect(await t.ledger.getBalance('alice')).toBe(90);
  });

  it('scopes idempotency keys per user', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('alice');
    await t.fund('bob');
    const a = await t.forecast('alice', m.id, 'YES', 10, 'shared');
    const b = await t.forecast('bob', m.id, 'YES', 10, 'shared');
    expect(a.forecastId).not.toBe(b.forecastId);
  });

  it('accepts exactly one of many simultaneous identical requests', async () => {
    const t = setup();
    const m = await t.createMarket();
    await t.fund('alice', 100);
    const receipts = await Promise.all(Array.from({ length: 25 }, () => t.forecast('alice', m.id, 'YES', 10, 'dup')));
    expect(new Set(receipts.map((r) => r.forecastId)).size).toBe(1);
    expect(receipts.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await t.ledger.getBalance('alice')).toBe(90);
    expect(await t.repo.listForecastsByMarket(m.id)).toHaveLength(1);
  });

  it('keeps sequences and snapshots consistent under concurrent load', async () => {
    const t = setup();
    const m = await t.createMarket();
    const users = Array.from({ length: 60 }, (_, i) => `u${i}`);
    await Promise.all(users.map((u) => t.fund(u)));
    const receipts = await Promise.all(users.map((u, i) => t.forecast(u, m.id, i % 3 === 0 ? 'YES' : 'NO')));

    expect(receipts.map((r) => r.sequence).sort((a, b) => a - b)).toEqual(users.map((_, i) => i + 1));
    // Each receipt's "before" equals the previous receipt's "after", in sequence order.
    const ordered = [...receipts].sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!.entry.generalBefore).toBe(ordered[i - 1]!.entry.generalAfter);
    }
    const snaps = await t.repo.listSnapshots(m.id);
    expect(snaps.map((s) => s.sequence)).toEqual(users.map((_, i) => i + 1));
    expect(snaps.at(-1)!.general).toBeCloseTo(20 / 60);
  });

  it('never overdraws a balance when one user races across markets', async () => {
    const t = setup();
    const markets = await Promise.all([t.createMarket(), t.createMarket(), t.createMarket()]);
    await t.fund('alice', 100);
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => t.forecast('alice', markets[i % 3]!.id, 'YES', 20)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(5);
    expect(failed.every((f) => f.reason.code === 'INSUFFICIENT_BALANCE')).toBe(true);
    expect(await t.ledger.getBalance('alice')).toBe(0);
  });

  it('refunds the stake when the forecast cannot be stored', async () => {
    const t = setup();
    const failingRepo: ForecastRepository = Object.create(t.repo);
    failingRepo.recordForecast = async () => {
      throw new Error('db down');
    };
    const t2 = setup({ repo: failingRepo, ledger: t.ledger, traders: t.traders, clock: t.clock });
    const m = await t.createMarket();
    await t.fund('alice', 100);
    await expect(t2.forecast('alice', m.id, 'YES', 40)).rejects.toThrow('db down');
    expect(await t.ledger.getBalance('alice')).toBe(100);
    const reasons = (await t.ledger.listTransactions('alice')).map((x) => x.reason);
    expect(reasons).toEqual(['grant', 'forecast_stake', 'forecast_stake_reversal']);
  });
});
