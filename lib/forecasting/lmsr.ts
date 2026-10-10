// LMSR (logarithmic market scoring rule) automated market maker.
//
//   cost C(qYes, qNo) = b * ln(e^(qYes/b) + e^(qNo/b))
//   YES price         = e^(qYes/b) / (e^(qYes/b) + e^(qNo/b))
//
// A YES share pays 1 credit if the question resolves YES. Every formula uses a
// log-sum-exp form so large q/b values never overflow.
//
// Team decisions (2026-10-10): open at the model baseline p0 (clamped to
// 5%-95%) with qNo = 0 and qYes = b ln(p0 / (1 - p0)); users spend credits and
// receive shares; buy only for v1 (exit by buying the other side).

import type { Side } from './types';

export interface LmsrState {
  b: number;
  qYes: number;
  qNo: number;
}

export const MIN_OPENING_PRICE = 0.05;
export const MAX_OPENING_PRICE = 0.95;

/** ln(e^a + e^b) without overflow. */
export function logSumExp(a: number, b: number): number {
  const m = Math.max(a, b);
  if (m === -Infinity) return -Infinity;
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

export function assertValidB(b: number): void {
  if (!Number.isFinite(b) || b <= 0) throw new Error(`LMSR liquidity b must be a positive number, got ${b}`);
}

export function clampOpeningPrice(p0: number): number {
  if (!Number.isFinite(p0)) throw new Error(`Opening price must be a number, got ${p0}`);
  return Math.min(MAX_OPENING_PRICE, Math.max(MIN_OPENING_PRICE, p0));
}

/** Market state before any trade: priced at p0 (clamped), with qNo = 0. */
export function openingState(p0: number, b: number): LmsrState {
  assertValidB(b);
  const p = clampOpeningPrice(p0);
  return { b, qYes: b * Math.log(p / (1 - p)), qNo: 0 };
}

export function cost(s: LmsrState): number {
  return s.b * logSumExp(s.qYes / s.b, s.qNo / s.b);
}

/** Current YES price (the market probability), in (0, 1). */
export function yesPrice(s: LmsrState): number {
  // Logistic of (qYes - qNo) / b, written to stay stable for large differences.
  const d = (s.qYes - s.qNo) / s.b;
  return d >= 0 ? 1 / (1 + Math.exp(-d)) : Math.exp(d) / (1 + Math.exp(d));
}

export function sidePrice(s: LmsrState, side: Side): number {
  const p = yesPrice(s);
  return side === 'YES' ? p : 1 - p;
}

/**
 * Shares received for spending `credits` on one side. Closed form for YES:
 *   x = b ln[(e^(qYes/b) + e^(qNo/b)) e^(c/b) - e^(qNo/b)] - qYes
 * computed as b (A + ln(1 - e^(B - A))) - qYes with A = lse(qYes/b, qNo/b) + c/b,
 * B = qNo/b, which never overflows. NO is the mirror image.
 */
export function sharesForSpend(s: LmsrState, side: Side, credits: number): number {
  if (!Number.isFinite(credits) || credits <= 0) throw new Error(`Spend must be positive, got ${credits}`);
  const own = side === 'YES' ? s.qYes : s.qNo;
  const other = side === 'YES' ? s.qNo : s.qYes;
  const A = logSumExp(s.qYes / s.b, s.qNo / s.b) + credits / s.b;
  const B = other / s.b;
  return s.b * (A + Math.log1p(-Math.exp(B - A))) - own;
}

/** Credits it costs to buy `shares` of one side. The inverse of sharesForSpend; used for checks and future selling. */
export function spendForShares(s: LmsrState, side: Side, shares: number): number {
  const after = side === 'YES' ? { ...s, qYes: s.qYes + shares } : { ...s, qNo: s.qNo + shares };
  return cost(after) - cost(s);
}

export function applyTrade(s: LmsrState, side: Side, shares: number): LmsrState {
  return side === 'YES' ? { ...s, qYes: s.qYes + shares } : { ...s, qNo: s.qNo + shares };
}

export interface TradeQuote {
  side: Side;
  credits: number;
  shares: number;
  /** Credits per share actually paid. */
  averagePrice: number;
  /** YES price before and after the trade. */
  priceBefore: number;
  priceAfter: number;
  stateAfter: LmsrState;
}

export function quoteTrade(s: LmsrState, side: Side, credits: number): TradeQuote {
  const shares = sharesForSpend(s, side, credits);
  const stateAfter = applyTrade(s, side, shares);
  return {
    side,
    credits,
    shares,
    averagePrice: credits / shares,
    priceBefore: yesPrice(s),
    priceAfter: yesPrice(stateAfter),
    stateAfter,
  };
}

/** Most the market maker can lose on one market opened at p0: b ln(1 / min(p0, 1 - p0)). */
export function worstCaseLoss(p0: number, b: number): number {
  const p = clampOpeningPrice(p0);
  return b * Math.log(1 / Math.min(p, 1 - p));
}

/** Replays trades (credits spent per side, in order) from the opening state. */
export function replay(p0: number, b: number, trades: ReadonlyArray<{ side: Side; credits: number }>): LmsrState {
  let s = openingState(p0, b);
  for (const t of trades) s = applyTrade(s, t.side, sharesForSpend(s, t.side, t.credits));
  return s;
}

// ---------------------------------------------------------------------------
// Liquidity (b)

export interface LiquidityConfig {
  /** b for a full-confidence baseline when users start with `referenceBalance` credits. */
  baseB: number;
  /** Starting balance baseB is calibrated for. b scales linearly with the actual starting balance. */
  referenceBalance: number;
  /** Multiplier applied when the model's baseline is low-confidence, so the crowd moves the price faster. */
  lowConfidenceFactor: number;
}

/**
 * b ~= 1,700 makes a 100-credit trade at p = 0.5 move the price about 3 points
 * (the move is roughly c (1 - p) / b) when users start with about 1,000 credits.
 */
export const defaultLiquidity: LiquidityConfig = {
  baseB: 1_700,
  referenceBalance: 1_000,
  lowConfidenceFactor: 0.6,
};

export function liquidityFor(input: { startingBalance: number; lowConfidence: boolean }, cfg: LiquidityConfig = defaultLiquidity): number {
  const scaled = cfg.baseB * (input.startingBalance / cfg.referenceBalance);
  const b = input.lowConfidence ? scaled * cfg.lowConfidenceFactor : scaled;
  assertValidB(b);
  return b;
}
