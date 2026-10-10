// Interfaces the engine depends on. Everything here is either owned by another
// component (Engineer 1's ledger and resolution workflow, the verification
// service, auth) or blocked on an open decision (pricing rule, settlement model,
// database and locking). Swap implementations without touching engine code.

import type {
  Forecast,
  LedgerTransaction,
  Market,
  MarketSnapshot,
  SettlementRecord,
  EstimateKind,
  Side,
} from './types';

// ---------------------------------------------------------------------------
// Auth

/** Who is calling. Produced by the auth layer (stack not yet chosen). */
export type AuthContext =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string }
  | { kind: 'service'; serviceId: string };

// ---------------------------------------------------------------------------
// Engineer 1: credit ledger

export interface LedgerEntryRequest {
  userId: string;
  amount: number;
  reason: string;
  /** What the entry is for, e.g. a forecast or market id. */
  reference: string;
  /** Repeating a request with the same key must return the original transaction, not apply it twice. */
  idempotencyKey: string;
}

/**
 * Engineer 1's credit ledger. The engine never keeps its own balances.
 * Required guarantees: debit is atomic (check-and-subtract) and throws
 * InsufficientBalanceError when the balance is too low; debit and credit are
 * idempotent by key.
 */
export interface CreditLedger {
  getBalance(userId: string): Promise<number>;
  debit(req: LedgerEntryRequest): Promise<LedgerTransaction>;
  credit(req: LedgerEntryRequest): Promise<LedgerTransaction>;
  /** In the order the transactions were applied. */
  listTransactions(userId: string): Promise<LedgerTransaction[]>;
}

// ---------------------------------------------------------------------------
// Verification service

export interface TraderDirectory {
  /** Verified user of this company's product (screenshot + one-time code approved). */
  isVerifiedUserOf(userId: string, companyId: string): Promise<boolean>;
  /** Declared or detected employee, advisor or investor relationship. */
  hasConflictOfInterest(userId: string, companyId: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Pricing (BLOCKED on the open pricing decision: LMSR vs allocation share)

export interface EstimateEntry {
  forecastId: string;
  side: Side;
  amount: number;
  sequence: number;
  fill?: Record<string, number>;
}

/**
 * Turns a baseline and an ordered list of forecasts into a community estimate.
 * The specialized line is the same rule replayed over verified forecasts only.
 * No implementation ships until the pricing decision is made.
 */
export interface CommunityEstimateRule {
  readonly id: string;
  readonly kind: EstimateKind;
  /**
   * Returns a value in [0, 1], or null when there is no estimate (for example an
   * empty market under a rule that has no starting price).
   */
  compute(baseline: number | null, entries: readonly EstimateEntry[]): number | null;
  /** Optional per-forecast fill details stored on the forecast (e.g. LMSR shares bought). */
  describeFill?(
    baseline: number | null,
    prior: readonly EstimateEntry[],
    next: Omit<EstimateEntry, 'fill'>,
    market?: Market,
  ): Record<string, number>;
}

// ---------------------------------------------------------------------------
// Settlement (BLOCKED: the "agreed virtual settlement model" isn't specified)

export interface SettlementModel {
  readonly id: string;
  /**
   * Payout in whole credits for every forecast in a market that resolved YES or NO.
   * Must return exactly one non-negative integer payout per forecast.
   * VOID outcomes never reach the model; the engine refunds stakes.
   */
  computePayouts(input: {
    market: Market;
    outcome: 'YES' | 'NO';
    forecasts: readonly Forecast[];
  }): Array<{ forecastId: string; payout: number }>;
}

/** Decides whether a caller is Engineer 1's authorized resolution workflow. */
export interface SettlementAuthorizer {
  isAuthorizedResolutionCaller(auth: AuthContext): boolean;
}

// ---------------------------------------------------------------------------
// Storage and concurrency (stack and row-lock approach not yet confirmed)

export interface ForecastRepository {
  getMarket(marketId: string): Promise<Market | null>;
  saveMarket(market: Market): Promise<void>;
  listMarkets(): Promise<Market[]>;

  findForecastByIdempotencyKey(userId: string, idempotencyKey: string): Promise<Forecast | null>;
  /**
   * Atomically inserts the forecast and its history snapshot (one DB transaction).
   * Must reject a second forecast with the same (userId, idempotencyKey).
   */
  recordForecast(forecast: Forecast, snapshot: MarketSnapshot): Promise<void>;
  /** Ordered by sequence ascending. */
  listForecastsByMarket(marketId: string): Promise<Forecast[]>;
  listForecastsByUser(userId: string): Promise<Forecast[]>;

  appendSnapshot(snapshot: MarketSnapshot): Promise<void>;
  /** Ordered by sequence ascending. */
  listSnapshots(marketId: string): Promise<MarketSnapshot[]>;

  getSettlement(marketId: string): Promise<SettlementRecord | null>;
  saveSettlement(record: SettlementRecord): Promise<void>;
  listSettlements(): Promise<SettlementRecord[]>;
}

/**
 * Serializes work on the given keys. In a database this maps to row locks
 * (e.g. SELECT ... FOR UPDATE on the market row). Implementations must acquire
 * keys in a stable order so callers can't deadlock.
 */
export interface LockManager {
  withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T>;
}

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(prefix: string): string;
}
