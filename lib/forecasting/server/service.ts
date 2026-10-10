import "server-only";

// Server entry points for the forecasting API. Each write runs the engine
// inside one database transaction: the market row lock, the ledger debit, the
// forecast insert and its snapshot commit together or not at all.

import { ApiError } from "@/lib/api-response";
import { createCreditLedger } from "@/lib/credit-ledger";
import { db, type TxClient } from "@/lib/db";
import { isVerifiedUserOf } from "@/lib/product-verification";
import { createForecastingEngine, type ForecastingEngine } from "../engine";
import { ForecastingError, type ForecastingErrorCode } from "../errors";
import { createLmsrRule, createLmsrSettlement } from "../lmsr-pricing";
import type { Clock, TraderDirectory } from "../ports";
import { systemClock, uuidIds } from "../adapters/simple";
import { PrismaForecastRepository, PrismaLockManager } from "./prisma-repository";

/** Verified product users come from lib/product-verification.ts. Conflicts aren't tracked yet. */
function tradersFor(tx: TxClient): TraderDirectory {
  return {
    isVerifiedUserOf: (userId, companyId) => isVerifiedUserOf(userId, companyId, tx),
    hasConflictOfInterest: async () => false,
  };
}

/**
 * Ky's ledger doesn't accept market-maker entries yet, so stakes and payouts
 * only touch traders' balances. When it does, set this to the market maker's
 * system user id (see docs/forecasting-lmsr-for-ky.md, section 2).
 */
export const MARKET_MAKER_ACCOUNT_ID: string | undefined = undefined;

export const MARKET_MAKER_SERVICE = "forecasting-settlement";

export function engineFor(tx: TxClient, clock: Clock = systemClock): ForecastingEngine {
  return createForecastingEngine({
    repo: new PrismaForecastRepository(tx),
    ledger: createCreditLedger(tx),
    locks: new PrismaLockManager(tx),
    clock,
    ids: uuidIds,
    traders: tradersFor(tx),
    settlementAuthorizer: { isAuthorizedResolutionCaller: (a) => a.kind === "service" && a.serviceId === MARKET_MAKER_SERVICE },
    estimateRule: createLmsrRule(),
    settlementModel: createLmsrSettlement(),
    modelServiceIds: ["model-service"],
    ...(MARKET_MAKER_ACCOUNT_ID ? { marketMakerAccountId: MARKET_MAKER_ACCOUNT_ID } : {}),
  });
}

/** Runs engine work in a transaction. Read-only work can share the same path. */
export function withEngine<T>(work: (engine: ForecastingEngine, tx: TxClient) => Promise<T>, opts: { timeout?: number } = {}) {
  return db.$transaction((tx) => work(engineFor(tx), tx), { timeout: opts.timeout ?? 15_000 });
}

const CODE_MAP: Record<ForecastingErrorCode, ApiError["code"]> = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  VALIDATION_FAILED: "VALIDATION_ERROR",
  MARKET_NOT_FOUND: "NOT_FOUND",
  MARKET_NOT_OPEN: "INVALID_STATE",
  MARKET_NOT_STARTED: "INVALID_STATE",
  DEADLINE_PASSED: "INVALID_STATE",
  NOT_ELIGIBLE: "FORBIDDEN",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_CREDITS",
  IDEMPOTENCY_CONFLICT: "CONFLICT",
  PRICE_MOVED: "CONFLICT",
  SETTLEMENT_CONFLICT: "CONFLICT",
  SETTLEMENT_NOT_ALLOWED: "INVALID_STATE",
  NOT_CONFIGURED: "INTERNAL_ERROR",
  INVARIANT_VIOLATION: "INTERNAL_ERROR",
};

/** Converts engine errors to the shared API envelope; `details.reason` keeps the engine's code. */
export function toApiError(error: unknown): unknown {
  if (!(error instanceof ForecastingError)) return error;
  const code = CODE_MAP[error.code];
  const message = code === "INTERNAL_ERROR" ? "Forecasting is not available right now" : error.message;
  return new ApiError(code, message, { reason: error.code, ...(error.details ?? {}) });
}

export async function translateErrors<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toApiError(error);
  }
}
