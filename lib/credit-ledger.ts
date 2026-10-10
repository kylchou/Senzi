import type { CreditTransaction } from "@/generated/prisma/client";
import { CreditTransactionType } from "@/generated/prisma/enums";
import { ApiError } from "@/lib/api-response";
import { applyCreditTransaction, InsufficientCreditsError, recordCreditTransaction } from "@/lib/credits";
import { db, type TxClient } from "@/lib/db";
import { ForecastingError, InsufficientBalanceError } from "@/lib/forecasting/errors";
import type { CreditLedger, LedgerEntryRequest } from "@/lib/forecasting/ports";
import type { LedgerTransaction } from "@/lib/forecasting/types";
import type { CreditMutationInput } from "@/lib/types";

/**
 * The forecasting engine's CreditLedger port, backed by the real ledger in
 * lib/credits.ts. The engine never keeps balances of its own.
 *
 * Only the reasons the engine actually uses are accepted, each mapped to one
 * ledger type, so the engine can't create grants or adjustments by accident.
 */
const DEBIT_REASONS = {
  forecast_stake: CreditTransactionType.FORECAST_STAKE,
} as const;

const CREDIT_REASONS = {
  forecast_stake_reversal: CreditTransactionType.FORECAST_REVERSAL,
  forecast_payout: CreditTransactionType.SETTLEMENT_PAYOUT,
  forecast_refund_void: CreditTransactionType.MARKET_REFUND,
} as const;

const REASON_BY_TYPE: Partial<Record<CreditTransactionType, string>> = {
  FORECAST_STAKE: "forecast_stake",
  FORECAST_REVERSAL: "forecast_stake_reversal",
  SETTLEMENT_PAYOUT: "forecast_payout",
  MARKET_REFUND: "forecast_refund_void",
};

function toMutation(req: LedgerEntryRequest, sign: 1 | -1, table: Record<string, CreditTransactionType>): CreditMutationInput {
  const type = table[req.reason];
  if (!type) {
    throw new ForecastingError("VALIDATION_FAILED", `Unsupported ledger reason "${req.reason}"`, { reason: req.reason });
  }
  if (!Number.isSafeInteger(req.amount) || req.amount <= 0) {
    throw new ForecastingError("VALIDATION_FAILED", "Ledger amounts must be positive whole credits", { amount: req.amount });
  }
  // The stake is taken before the Forecast row exists, so the reference is kept
  // in the memo rather than the forecastId foreign key.
  return { userId: req.userId, amount: sign * req.amount, type, idempotencyKey: req.idempotencyKey, memo: req.reference };
}

function toLedgerTransaction(row: CreditTransaction): LedgerTransaction {
  return {
    id: row.id,
    userId: row.userId,
    delta: row.amount,
    balanceAfter: row.balanceAfter,
    reason: REASON_BY_TYPE[row.type] ?? row.type.toLowerCase(),
    reference: row.forecastId ?? row.memo ?? row.id,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
  };
}

/** Converts ledger errors into the engine's typed errors. */
async function translate<T>(userId: string, requested: number, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InsufficientCreditsError) {
      throw new InsufficientBalanceError(userId, requested, error.balance);
    }
    if (error instanceof ApiError && error.code === "CONFLICT") {
      throw new ForecastingError("IDEMPOTENCY_CONFLICT", error.message);
    }
    throw error;
  }
}

/**
 * Pass a transaction client to make ledger writes part of a larger
 * transaction (e.g. the forecast insert). Without one, each call commits on
 * its own and is safe to retry with the same idempotency key.
 */
export function createCreditLedger(tx?: TxClient): CreditLedger {
  const apply = (mutation: CreditMutationInput) =>
    tx ? applyCreditTransaction(tx, mutation) : recordCreditTransaction(mutation);
  const client = tx ?? db;

  return {
    async getBalance(userId) {
      const user = await client.user.findUnique({ where: { id: userId }, select: { creditBalance: true } });
      if (!user) throw new ForecastingError("VALIDATION_FAILED", "Unknown user", { userId });
      return user.creditBalance;
    },

    async debit(req) {
      const mutation = toMutation(req, -1, DEBIT_REASONS);
      const { transaction } = await translate(req.userId, req.amount, () => apply(mutation));
      return toLedgerTransaction(transaction);
    },

    async credit(req) {
      const mutation = toMutation(req, 1, CREDIT_REASONS);
      const { transaction } = await translate(req.userId, req.amount, () => apply(mutation));
      return toLedgerTransaction(transaction);
    },

    async listTransactions(userId) {
      const rows = await client.creditTransaction.findMany({ where: { userId }, orderBy: { sequence: "asc" } });
      return rows.map(toLedgerTransaction);
    },
  };
}
