// Forecast submission: validate, check auth / market status / deadline /
// eligibility / balance, debit Engineer 1's ledger, record the forecast with
// its entry snapshot, and return an authoritative receipt.
//
// Duplicates: every request carries a client-generated idempotency key. Reusing a
// key with the same payload returns the original receipt; with a different
// payload it fails. Concurrency: work is serialized per market (and per key), so
// sequence numbers and before/after estimates are consistent.

import { createHash } from 'node:crypto';
import { marketLockKey, requireRule, requireUser, type EngineDeps } from './deps.js';
import { checkEligibility } from './eligibility.js';
import { ForecastingError, InsufficientBalanceError } from './errors.js';
import { computeLine, toEstimateEntries, verifiedOnly } from './estimates.js';
import { buildSnapshot } from './history.js';
import type { AuthContext } from './ports.js';
import type { EntrySnapshot, Forecast, Side } from './types.js';

export interface SubmitForecastInput {
  marketId: string;
  side: Side;
  amount: number;
  idempotencyKey: string;
}

export interface ForecastReceipt {
  receiptId: string;
  forecastId: string;
  marketId: string;
  userId: string;
  side: Side;
  amount: number;
  unitLabel: string;
  acceptedAt: Date;
  sequence: number;
  verifiedAtEntry: boolean;
  entry: EntrySnapshot;
  fill: Record<string, number> | null;
  ledgerTransactionId: string;
  /** Balance right after the stake was debited. */
  balanceAfter: number | null;
  /** True when this is a repeat of an already-accepted request. */
  replayed: boolean;
  /** SHA-256 over the receipt's authoritative fields, so clients can detect tampering or drift. */
  digest: string;
}

function validateInput(input: SubmitForecastInput, deps: EngineDeps): void {
  const fail = (message: string, field: string) => {
    throw new ForecastingError('VALIDATION_FAILED', message, { field });
  };
  if (input === null || typeof input !== 'object') fail('Request body is required', 'body');
  if (typeof input.marketId !== 'string' || input.marketId.trim() === '') fail('marketId is required', 'marketId');
  if (input.side !== 'YES' && input.side !== 'NO') fail('side must be YES or NO', 'side');
  if (typeof input.amount !== 'number' || !Number.isSafeInteger(input.amount) || input.amount <= 0) {
    fail('amount must be a positive whole number of credits', 'amount');
  }
  const key = input.idempotencyKey;
  if (typeof key !== 'string' || key.trim() === '') fail('idempotencyKey is required', 'idempotencyKey');
  if (key.length > deps.config.maxIdempotencyKeyLength) {
    fail(`idempotencyKey must be at most ${deps.config.maxIdempotencyKeyLength} characters`, 'idempotencyKey');
  }
}

export function hashRequest(input: SubmitForecastInput): string {
  return createHash('sha256')
    .update(JSON.stringify([input.marketId, input.side, input.amount]))
    .digest('hex');
}

function digestOf(f: Forecast): string {
  const canonical = JSON.stringify({
    forecastId: f.id,
    marketId: f.marketId,
    userId: f.userId,
    side: f.side,
    amount: f.amount,
    sequence: f.sequence,
    acceptedAt: f.acceptedAt.toISOString(),
    verifiedAtEntry: f.verifiedAtEntry,
    ledgerTransactionId: f.ledgerTransactionId,
    entry: {
      ...f.entry,
      modelAsOf: f.entry.modelAsOf ? f.entry.modelAsOf.toISOString() : null,
    },
    fill: f.fill ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function toReceipt(f: Forecast, unitLabel: string, balanceAfter: number | null, replayed: boolean): ForecastReceipt {
  return {
    receiptId: `rcpt_${f.id}`,
    forecastId: f.id,
    marketId: f.marketId,
    userId: f.userId,
    side: f.side,
    amount: f.amount,
    unitLabel,
    acceptedAt: f.acceptedAt,
    sequence: f.sequence,
    verifiedAtEntry: f.verifiedAtEntry,
    entry: f.entry,
    fill: f.fill ?? null,
    ledgerTransactionId: f.ledgerTransactionId,
    balanceAfter,
    replayed,
    digest: digestOf(f),
  };
}

async function replay(deps: EngineDeps, existing: Forecast, requestHash: string): Promise<ForecastReceipt> {
  if (existing.requestHash !== requestHash) {
    throw new ForecastingError(
      'IDEMPOTENCY_CONFLICT',
      'This idempotency key was already used for a different forecast',
      { forecastId: existing.id },
    );
  }
  const txs = await deps.ledger.listTransactions(existing.userId);
  const tx = txs.find((t) => t.id === existing.ledgerTransactionId);
  return toReceipt(existing, deps.config.unitLabel, tx?.balanceAfter ?? null, true);
}

export async function submitForecast(
  deps: EngineDeps,
  auth: AuthContext,
  input: SubmitForecastInput,
): Promise<ForecastReceipt> {
  validateInput(input, deps);
  const userId = requireUser(auth);
  const rule = requireRule(deps);
  const requestHash = hashRequest(input);
  const { repo, ledger, config } = deps;

  // Fast path for retries; re-checked under the lock below.
  const prior = await repo.findForecastByIdempotencyKey(userId, input.idempotencyKey);
  if (prior) return replay(deps, prior, requestHash);

  const lockKeys = [`idem:${userId}:${input.idempotencyKey}`, marketLockKey(input.marketId)];
  return deps.locks.withLocks(lockKeys, async () => {
    const raced = await repo.findForecastByIdempotencyKey(userId, input.idempotencyKey);
    if (raced) return replay(deps, raced, requestHash);

    const market = await repo.getMarket(input.marketId);
    if (!market) throw new ForecastingError('MARKET_NOT_FOUND', 'Market not found', { marketId: input.marketId });

    const now = deps.clock.now();
    if (market.status !== 'open') {
      throw new ForecastingError('MARKET_NOT_OPEN', `Market is ${market.status}`, { status: market.status });
    }
    if (market.opensAt && now < market.opensAt) {
      throw new ForecastingError('MARKET_NOT_STARTED', 'Market has not opened for forecasts yet', {
        opensAt: market.opensAt.toISOString(),
      });
    }
    if (now >= market.closesAt) {
      throw new ForecastingError('DEADLINE_PASSED', 'The forecast deadline has passed', {
        closesAt: market.closesAt.toISOString(),
      });
    }

    const min = market.minAmount ?? config.defaultMinAmount;
    const max = market.maxAmount ?? config.defaultMaxAmount;
    if (input.amount < min || input.amount > max) {
      throw new ForecastingError('VALIDATION_FAILED', `amount must be between ${min} and ${max}`, {
        field: 'amount',
        min,
        max,
      });
    }

    const eligibility = await checkEligibility(market, userId, deps.traders, config);
    if (!eligibility.eligible) {
      throw new ForecastingError('NOT_ELIGIBLE', 'You are not eligible to forecast on this market', {
        reason: eligibility.reason,
      });
    }

    // Friendly early check; the ledger's atomic debit is the real guarantee.
    const available = await ledger.getBalance(userId);
    if (available < input.amount) throw new InsufficientBalanceError(userId, input.amount, available);

    const existing = await repo.listForecastsByMarket(market.id);
    const sequence = (existing[existing.length - 1]?.sequence ?? 0) + 1;
    const opening = market.openingBaseline?.value ?? null;
    const generalBefore = computeLine(rule, opening, existing).value;
    const specializedBefore = computeLine(rule, opening, verifiedOnly(existing)).value;

    const forecastId = deps.ids.next('fc');
    const entryBase = { forecastId, side: input.side, amount: input.amount, sequence };
    const fill = rule.describeFill?.(opening, toEstimateEntries(existing), entryBase);

    // Debit first, so a forecast never exists without its stake being taken.
    const tx = await ledger.debit({
      userId,
      amount: input.amount,
      reason: 'forecast_stake',
      reference: forecastId,
      idempotencyKey: `forecast:${forecastId}`,
    });

    const draft: Forecast = {
      id: forecastId,
      marketId: market.id,
      userId,
      side: input.side,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      sequence,
      acceptedAt: now,
      verifiedAtEntry: eligibility.verified,
      ledgerTransactionId: tx.id,
      entry: {
        openingBaseline: opening,
        model: market.model?.value ?? null,
        modelAsOf: market.model?.asOf ?? null,
        modelVersion: market.model?.modelVersion ?? null,
        generalBefore,
        generalAfter: null,
        specializedBefore,
        specializedAfter: null,
        estimateRuleId: rule.id,
        estimateKind: rule.kind,
      },
      ...(fill ? { fill } : {}),
    };
    const all = [...existing, draft];
    const after = buildSnapshot({
      market,
      forecasts: all,
      rule,
      trigger: 'forecast',
      at: now,
      sequence: (await repo.listSnapshots(market.id)).length + 1,
      forecastId,
    });
    draft.entry.generalAfter = after.general;
    draft.entry.specializedAfter = after.specialized;

    try {
      await repo.recordForecast(draft, after);
    } catch (err) {
      // Give the stake back if the forecast couldn't be stored. In production the
      // debit and insert should share one transaction with Engineer 1's ledger.
      await ledger.credit({
        userId,
        amount: input.amount,
        reason: 'forecast_stake_reversal',
        reference: forecastId,
        idempotencyKey: `forecast-reversal:${forecastId}`,
      });
      throw err;
    }

    return toReceipt(draft, config.unitLabel, tx.balanceAfter, false);
  });
}
