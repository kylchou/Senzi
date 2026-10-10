import { randomUUID } from 'node:crypto';
import { ForecastingError, InsufficientBalanceError } from '../errors';
import type { Clock, CreditLedger, LedgerEntryRequest } from '../ports';
import type { LedgerTransaction } from '../types';

/**
 * DEV STAND-IN for Engineer 1's credit ledger, for tests and local runs only.
 * It implements the CreditLedger contract (atomic debit, idempotent by key) so
 * the engine can be exercised end to end. Do not ship it as the real ledger.
 */
export class InMemoryCreditLedger implements CreditLedger {
  private readonly balances = new Map<string, number>();
  private readonly transactions: LedgerTransaction[] = [];
  private readonly byKey = new Map<string, { tx: LedgerTransaction; fingerprint: string }>();

  constructor(private readonly clock: Clock = { now: () => new Date() }) {}

  /** Test helper: give a user a starting balance. */
  async grant(userId: string, amount: number, idempotencyKey = `grant:${randomUUID()}`) {
    return this.apply({ userId, amount, reason: 'grant', reference: 'grant', idempotencyKey }, amount);
  }

  async getBalance(userId: string) {
    return this.balances.get(userId) ?? 0;
  }

  async debit(req: LedgerEntryRequest) {
    return this.apply(req, -req.amount);
  }

  async credit(req: LedgerEntryRequest) {
    return this.apply(req, req.amount);
  }

  async listTransactions(userId: string) {
    return this.transactions.filter((t) => t.userId === userId).map((t) => ({ ...t }));
  }

  /** Synchronous body: no await between the balance check and the write, so it is atomic. */
  private apply(req: LedgerEntryRequest, delta: number): LedgerTransaction {
    if (!Number.isSafeInteger(req.amount) || req.amount <= 0) {
      throw new ForecastingError('VALIDATION_FAILED', 'Ledger amount must be a positive integer');
    }
    const fingerprint = `${req.userId}|${delta}|${req.reference}`;
    const prior = this.byKey.get(req.idempotencyKey);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new ForecastingError('IDEMPOTENCY_CONFLICT', 'Ledger idempotency key reused with different parameters');
      }
      return { ...prior.tx };
    }
    const balance = this.balances.get(req.userId) ?? 0;
    if (balance + delta < 0) throw new InsufficientBalanceError(req.userId, req.amount, balance);
    const tx: LedgerTransaction = {
      id: `tx_${randomUUID()}`,
      userId: req.userId,
      delta,
      balanceAfter: balance + delta,
      reason: req.reason,
      reference: req.reference,
      idempotencyKey: req.idempotencyKey,
      createdAt: this.clock.now(),
    };
    this.balances.set(req.userId, tx.balanceAfter);
    this.transactions.push(tx);
    this.byKey.set(req.idempotencyKey, { tx, fingerprint });
    return { ...tx };
  }
}
