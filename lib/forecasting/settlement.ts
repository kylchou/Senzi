// Idempotent market settlement, called only by Engineer 1's authorized
// resolution workflow.
//
// Guarantees:
// - An outcome is applied once. Repeating the same call returns the stored
//   result; a call with a different outcome or resolution id is rejected.
// - Every payout is a ledger credit with a deterministic idempotency key, so a
//   crash partway through can be resumed by calling again without double paying.
// - Payout amounts are computed once and stored before any credit is issued, so
//   a resumed run pays exactly what the first run planned.

import { marketLockKey, requireSettlementModel, type EngineDeps } from './deps.js';
import { ForecastingError } from './errors.js';
import { buildSnapshot } from './history.js';
import type { AuthContext, CreditLedger } from './ports.js';
import type { Forecast, Market, Outcome, Payout, SettlementRecord } from './types.js';

export interface SettleMarketInput {
  marketId: string;
  outcome: Outcome;
  /** Id of the resolution in Engineer 1's workflow (ties the settlement to its evidence). */
  resolutionId: string;
  resolvedAt: Date;
}

export interface SettleMarketResult {
  record: SettlementRecord;
  alreadySettled: boolean;
}

/** Model id recorded for VOID settlements, where stakes are refunded in full. */
export const VOID_REFUND_MODEL_ID = 'void-refund';

function validate(input: SettleMarketInput): void {
  if (input.outcome !== 'YES' && input.outcome !== 'NO' && input.outcome !== 'VOID') {
    throw new ForecastingError('VALIDATION_FAILED', 'outcome must be YES, NO or VOID', { field: 'outcome' });
  }
  if (typeof input.resolutionId !== 'string' || input.resolutionId.trim() === '') {
    throw new ForecastingError('VALIDATION_FAILED', 'resolutionId is required', { field: 'resolutionId' });
  }
  if (!(input.resolvedAt instanceof Date) || Number.isNaN(input.resolvedAt.getTime())) {
    throw new ForecastingError('VALIDATION_FAILED', 'resolvedAt must be a valid date', { field: 'resolvedAt' });
  }
}

export function planPayouts(deps: Pick<EngineDeps, 'settlementModel'>, market: Market, outcome: Outcome, forecasts: Forecast[]): { modelId: string; payouts: Payout[] } {
  if (outcome === 'VOID') {
    return {
      modelId: VOID_REFUND_MODEL_ID,
      payouts: forecasts.map((f) => ({
        forecastId: f.id,
        userId: f.userId,
        stake: f.amount,
        payout: f.amount,
        net: 0,
        ledgerTransactionId: null,
      })),
    };
  }

  const model = requireSettlementModel(deps);
  const raw = model.computePayouts({ market, outcome, forecasts });
  const byId = new Map<string, number>();
  for (const p of raw) {
    if (byId.has(p.forecastId)) {
      throw new ForecastingError('INVARIANT_VIOLATION', `Settlement model paid forecast ${p.forecastId} twice`);
    }
    if (!Number.isSafeInteger(p.payout) || p.payout < 0) {
      throw new ForecastingError('INVARIANT_VIOLATION', `Settlement model returned invalid payout ${p.payout}`, {
        forecastId: p.forecastId,
      });
    }
    byId.set(p.forecastId, p.payout);
  }
  const payouts = forecasts.map((f) => {
    const payout = byId.get(f.id);
    if (payout === undefined) {
      throw new ForecastingError('INVARIANT_VIOLATION', `Settlement model skipped forecast ${f.id}`);
    }
    byId.delete(f.id);
    return { forecastId: f.id, userId: f.userId, stake: f.amount, payout, net: payout - f.amount, ledgerTransactionId: null };
  });
  if (byId.size > 0) {
    throw new ForecastingError('INVARIANT_VIOLATION', 'Settlement model paid forecasts that are not in this market', {
      unknown: [...byId.keys()],
    });
  }
  return { modelId: model.id, payouts };
}

/**
 * Pays out a planned settlement through the ledger. Every write has a
 * deterministic idempotency key, so calling this again after a crash pays
 * nobody twice. With a market-maker account, the market maker funds payouts
 * from the stakes it received; any shortfall (the LMSR subsidy) is minted to
 * it once per market first, so the ledger balances. Returns the ledger
 * transaction id for each payout, keyed by forecast id.
 */
export async function applyPayouts(
  ledger: CreditLedger,
  input: { marketId: string; outcome: Outcome; payouts: readonly Payout[]; marketMakerAccountId?: string },
): Promise<Map<string, string>> {
  const { marketId, outcome, payouts, marketMakerAccountId: mm } = input;
  const txIds = new Map<string, string>();
  if (mm) {
    const totalPayout = payouts.reduce((s, p) => s + p.payout, 0);
    const totalStakes = payouts.reduce((s, p) => s + p.stake, 0);
    const shortfall = totalPayout - totalStakes;
    if (shortfall > 0) {
      await ledger.credit({
        userId: mm,
        amount: shortfall,
        reason: 'market_maker_mint',
        reference: marketId,
        idempotencyKey: `market-maker:mint:${marketId}`,
      });
    }
  }
  for (const p of payouts) {
    if (p.payout === 0) continue;
    if (mm) {
      await ledger.debit({
        userId: mm,
        amount: p.payout,
        reason: 'market_maker_pay',
        reference: p.forecastId,
        idempotencyKey: `market-maker:out:${marketId}:${p.forecastId}`,
      });
    }
    const tx = await ledger.credit({
      userId: p.userId,
      amount: p.payout,
      reason: outcome === 'VOID' ? 'forecast_refund_void' : 'forecast_payout',
      reference: p.forecastId,
      idempotencyKey: `settlement:${marketId}:${p.forecastId}`,
    });
    txIds.set(p.forecastId, tx.id);
  }
  return txIds;
}

export async function settleMarket(
  deps: EngineDeps,
  auth: AuthContext,
  input: SettleMarketInput,
): Promise<SettleMarketResult> {
  if (!deps.settlementAuthorizer.isAuthorizedResolutionCaller(auth) || auth.kind !== 'service') {
    throw new ForecastingError('FORBIDDEN', 'Only the authorized resolution workflow can settle markets');
  }
  validate(input);
  const requestedBy = auth.serviceId;
  const { repo, ledger } = deps;

  return deps.locks.withLocks([marketLockKey(input.marketId)], async () => {
    let record = await repo.getSettlement(input.marketId);
    if (record) {
      if (record.outcome !== input.outcome || record.resolutionId !== input.resolutionId) {
        throw new ForecastingError('SETTLEMENT_CONFLICT', 'Market was already settled with a different outcome', {
          settledOutcome: record.outcome,
          settledResolutionId: record.resolutionId,
        });
      }
      if (record.status === 'completed') return { record, alreadySettled: true };
      // status === 'in_progress': a previous run stopped partway. Resume it.
    }

    const market = await repo.getMarket(input.marketId);
    if (!market) throw new ForecastingError('MARKET_NOT_FOUND', 'Market not found', { marketId: input.marketId });

    if (!record) {
      if (market.status === 'pending_quorum' || market.status === 'cancelled') {
        throw new ForecastingError('SETTLEMENT_NOT_ALLOWED', `A ${market.status} market can't be settled`, {
          status: market.status,
        });
      }
      if (market.status === 'resolved') {
        throw new ForecastingError('INVARIANT_VIOLATION', 'Market is resolved but has no settlement record');
      }
      if (deps.clock.now() < market.closesAt) {
        throw new ForecastingError('SETTLEMENT_NOT_ALLOWED', 'Market is still accepting forecasts', {
          closesAt: market.closesAt.toISOString(),
        });
      }

      const forecasts = await repo.listForecastsByMarket(market.id);
      const plan = planPayouts(deps, market, input.outcome, forecasts);
      record = {
        marketId: market.id,
        outcome: input.outcome,
        resolutionId: input.resolutionId,
        resolvedAt: input.resolvedAt,
        settledAt: null,
        status: 'in_progress',
        settlementModelId: plan.modelId,
        requestedBy,
        payouts: plan.payouts,
      };
      await repo.saveSettlement(record);
    }

    // Ledger idempotency keys make this safe to repeat on a resumed run.
    const txIds = await applyPayouts(ledger, {
      marketId: record.marketId,
      outcome: input.outcome,
      payouts: record.payouts,
      ...(deps.marketMakerAccountId ? { marketMakerAccountId: deps.marketMakerAccountId } : {}),
    });
    for (const p of record.payouts) p.ledgerTransactionId = txIds.get(p.forecastId) ?? p.ledgerTransactionId;
    await repo.saveSettlement(record);

    // Each remaining step is safe to repeat if a resumed run gets here again.
    const settledAt = deps.clock.now();
    const resolvedMarket: Market = { ...market, status: 'resolved' };
    await repo.saveMarket(resolvedMarket);
    const snapshots = await repo.listSnapshots(market.id);
    if (!snapshots.some((s) => s.trigger === 'settlement')) {
      await repo.appendSnapshot(
        buildSnapshot({
          market: resolvedMarket,
          forecasts: await repo.listForecastsByMarket(market.id),
          rule: deps.estimateRule,
          trigger: 'settlement',
          at: settledAt,
          sequence: snapshots.reduce((m, s) => Math.max(m, s.sequence), 0) + 1,
        }),
      );
    }
    record = { ...record, status: 'completed', settledAt };
    await repo.saveSettlement(record);
    return { record, alreadySettled: false };
  });
}
