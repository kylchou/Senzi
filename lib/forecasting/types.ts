// Domain types for the Senzi forecasting engine (Engineer 2).
//
// Amounts are integer credits. The credit balance itself lives in Engineer 1's
// ledger (see CreditLedger in ports.ts); this engine never stores balances.

export type Side = 'YES' | 'NO';

/** VOID covers questions voided for manipulation or an unusable resolution source. */
export type Outcome = 'YES' | 'NO' | 'VOID';

/**
 * Market lifecycle. Quorum handling and opening belong to other components;
 * the engine only accepts forecasts while a market is `open` and inside its window.
 */
export type MarketStatus = 'draft' | 'pending_quorum' | 'open' | 'closed' | 'resolved' | 'cancelled';

export interface Baseline {
  /** Model probability of YES, in [0, 1]. Set by the model, never by forecasts. */
  value: number;
  /** When the model computed this value. */
  asOf: Date;
  modelVersion: string;
  /** Short human-readable note on the inputs, e.g. "npm downloads + sponsor-provided MAU". */
  inputsNote?: string;
}

export interface Market {
  id: string;
  companyId: string;
  question: string;
  sponsorId: string;
  status: MarketStatus;
  /** Forecasts are rejected before this time (optional; defaults to "as soon as open"). */
  opensAt?: Date;
  /** Submission deadline. Forecasts at or after this instant are rejected. */
  closesAt: Date;
  /**
   * The model's value when forecasting started. Community estimates start from it.
   * Follows the model until the first forecast is accepted, then is frozen.
   */
  openingBaseline: Baseline | null;
  /** Latest model value (chart 1). Refreshes only when new data arrives, never from forecasts. */
  model: Baseline | null;
  /** Per-forecast amount limits in credits (inclusive). */
  minAmount?: number;
  maxAmount?: number;
  /** LMSR liquidity for this market before its first trade (frozen in each fill afterwards). */
  lmsrB?: number;
  createdAt: Date;
}

/** Immutable record of one accepted forecast. Never updated after insert. */
export interface Forecast {
  id: string;
  marketId: string;
  userId: string;
  side: Side;
  amount: number;
  idempotencyKey: string;
  /** Hash of the request payload, used to detect a reused key with a different payload. */
  requestHash: string;
  /** 1-based position in the market's forecast sequence. */
  sequence: number;
  acceptedAt: Date;
  /** True when the user was a verified user of the company's product at entry time. */
  verifiedAtEntry: boolean;
  ledgerTransactionId: string;
  /** Market state captured at entry. Preserved even when estimates later change. */
  entry: EntrySnapshot;
  /** Rule-specific fill details (e.g. shares acquired). Shape depends on the pricing rule. */
  fill?: Record<string, number>;
}

export interface EntrySnapshot {
  openingBaseline: number | null;
  model: number | null;
  modelAsOf: Date | null;
  modelVersion: string | null;
  generalBefore: number | null;
  generalAfter: number | null;
  specializedBefore: number | null;
  specializedAfter: number | null;
  estimateRuleId: string;
  estimateKind: EstimateKind;
}

/**
 * What a community estimate number actually is. A credit allocation share is not a
 * probability; only a calibration report can promote an estimate to "calibrated".
 */
export type EstimateKind = 'allocation_share' | 'market_price';

export type ConfidenceLevel = 'none' | 'low' | 'medium' | 'high';

/** A display-ready estimate. Always carries a forecaster count and confidence label. */
export interface EstimateView {
  value: number | null;
  /** E.g. "62%". Null when there is no estimate. */
  display: string | null;
  label: string;
  /** Null when no pricing rule is configured. */
  kind: EstimateKind | null;
  isCalibratedProbability: boolean;
  forecasterCount: number;
  forecastCount: number;
  totalAmount: number;
  confidence: ConfidenceLevel;
  /** Present when no estimate can be shown, explaining why. */
  emptyReason?: string;
}

export interface BaselineView {
  value: number | null;
  display: string | null;
  label: string;
  asOf: Date | null;
  modelVersion: string | null;
  inputsNote: string | null;
  emptyReason?: string;
}

export interface MarketEstimates {
  marketId: string;
  asOf: Date;
  /** Starting point for community estimates. */
  openingBaseline: BaselineView;
  /** Latest model value (chart 1). */
  model: BaselineView;
  /** All forecasts. */
  general: EstimateView;
  /** Replay of verified users' forecasts only, from the same starting point. */
  specialized: EstimateView;
}

export type SnapshotTrigger = 'forecast' | 'model_update' | 'settlement';

/** Append-only, timestamped point in a market's estimate history. */
export interface MarketSnapshot {
  marketId: string;
  /** Monotonic per market. */
  sequence: number;
  at: Date;
  trigger: SnapshotTrigger;
  /** The forecast that caused this snapshot, if any. */
  forecastId?: string;
  openingBaseline: number | null;
  model: number | null;
  general: number | null;
  specialized: number | null;
  generalForecasters: number;
  specializedForecasters: number;
  generalAmount: number;
  specializedAmount: number;
  /** Null when the snapshot was taken before any pricing rule was configured. */
  estimateRuleId: string | null;
  estimateKind: EstimateKind | null;
}

export interface Payout {
  forecastId: string;
  userId: string;
  stake: number;
  payout: number;
  /** payout - stake */
  net: number;
  ledgerTransactionId: string | null;
}

export interface SettlementRecord {
  marketId: string;
  outcome: Outcome;
  resolutionId: string;
  resolvedAt: Date;
  settledAt: Date | null;
  status: 'in_progress' | 'completed';
  settlementModelId: string;
  /** The workflow that requested settlement. */
  requestedBy: string;
  payouts: Payout[];
}

export interface LedgerTransaction {
  id: string;
  userId: string;
  /** Positive for credits to the user, negative for debits. */
  delta: number;
  balanceAfter: number;
  reason: string;
  reference: string;
  idempotencyKey: string;
  createdAt: Date;
}
