// Shared test setup.
//
// TEST FIXTURES ONLY: `countShareRule` and `doubleOrNothing` exist to exercise
// the engine. They are not proposals for the real pricing rule or settlement
// model, which are open decisions.

import {
  AllowListSettlementAuthorizer,
  createForecastingEngine,
  InMemoryCreditLedger,
  InMemoryForecastRepository,
  InProcessLockManager,
  ManualClock,
  StaticTraderDirectory,
  uuidIds,
  type AuthContext,
  type CommunityEstimateRule,
  type EngineOptions,
  type Market,
  type SettlementModel,
} from '../index';

/** Fraction of forecasts (by count, not amount) on YES. Null for an empty market. */
export const countShareRule: CommunityEstimateRule = {
  id: 'test-count-share',
  kind: 'allocation_share',
  compute(_baseline, entries) {
    if (entries.length === 0) return null;
    return entries.filter((e) => e.side === 'YES').length / entries.length;
  },
  describeFill(_baseline, prior) {
    return { priorForecasts: prior.length };
  },
};

/** Winners get twice their stake back, losers get nothing. */
export const doubleOrNothing: SettlementModel = {
  id: 'test-double-or-nothing',
  computePayouts({ outcome, forecasts }) {
    return forecasts.map((f) => ({ forecastId: f.id, payout: f.side === outcome ? f.amount * 2 : 0 }));
  },
};

export const T0 = new Date('2026-10-01T12:00:00Z');
export const DAY = 24 * 60 * 60 * 1000;

export const MODEL_SERVICE = 'model-service';
export const RESOLUTION_WORKFLOW = 'resolution-workflow';

export const asUser = (userId: string): AuthContext => ({ kind: 'user', userId });
export const anonymous: AuthContext = { kind: 'anonymous' };
export const modelService: AuthContext = { kind: 'service', serviceId: MODEL_SERVICE };
export const resolver: AuthContext = { kind: 'service', serviceId: RESOLUTION_WORKFLOW };

export function setup(overrides: Partial<EngineOptions> = {}) {
  const clock = new ManualClock(T0);
  const repo = new InMemoryForecastRepository();
  const ledger = new InMemoryCreditLedger(clock);
  const traders = new StaticTraderDirectory();
  const options: EngineOptions = {
    repo,
    ledger,
    locks: new InProcessLockManager(),
    clock,
    ids: uuidIds,
    traders,
    settlementAuthorizer: new AllowListSettlementAuthorizer([RESOLUTION_WORKFLOW]),
    estimateRule: countShareRule,
    settlementModel: doubleOrNothing,
    modelServiceIds: [MODEL_SERVICE],
    ...overrides,
  };
  const engine = createForecastingEngine(options);
  let marketCounter = 0;

  async function createMarket(fields: Partial<Market> = {}): Promise<Market> {
    marketCounter++;
    const market: Market = {
      id: `mkt_${marketCounter}`,
      companyId: 'acme',
      question: `Will Acme pass threshold #${marketCounter}?`,
      sponsorId: 'sponsor-1',
      status: 'open',
      closesAt: new Date(T0.getTime() + 7 * DAY),
      openingBaseline: { value: 0.4, asOf: T0, modelVersion: 'model-v0' },
      model: { value: 0.4, asOf: T0, modelVersion: 'model-v0' },
      createdAt: T0,
      ...fields,
    };
    await repo.saveMarket(market);
    return market;
  }

  let keyCounter = 0;
  async function forecast(userId: string, marketId: string, side: 'YES' | 'NO', amount = 10, idempotencyKey?: string) {
    return engine.submitForecast(asUser(userId), {
      marketId,
      side,
      amount,
      idempotencyKey: idempotencyKey ?? `k${++keyCounter}`,
    });
  }

  async function fund(userId: string, amount = 1000) {
    await ledger.grant(userId, amount);
  }

  return { engine, clock, repo, ledger, traders, options, createMarket, forecast, fund };
}

export async function expectCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (err) {
    const actual = (err as { code?: string }).code;
    if (actual !== code) throw new Error(`Expected error code ${code}, got ${actual ?? String(err)}`);
    return err as Error & { code: string; details?: Record<string, unknown> };
  }
  throw new Error(`Expected error code ${code}, but the call succeeded`);
}
