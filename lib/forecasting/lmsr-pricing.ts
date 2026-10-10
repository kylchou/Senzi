// LMSR as the engine's pricing rule and settlement model.
//
// Each forecast's fill records the market's b, so b is frozen by the first
// trade and every later trade and replay uses the same value. The general
// line replays all trades; the specialized line replays only verified users'
// trades from the same opening price, recomputing their shares.

import { defaultLiquidity, openingState, quoteTrade, replay, yesPrice, type LmsrState } from './lmsr';
import type { CommunityEstimateRule, EstimateEntry, SettlementModel } from './ports';
import type { Market } from './types';

export const LMSR_RULE_ID = 'lmsr-v1';
export const LMSR_SETTLEMENT_ID = 'lmsr-v1-shares';

/** Stored on every forecast as `fill`. */
export interface LmsrFill extends Record<string, number> {
  b: number;
  /** Opening price used to seed the market (after clamping). */
  p0: number;
  shares: number;
  averagePrice: number;
  priceBefore: number;
  priceAfter: number;
}

/** b for a market: frozen by its first trade, otherwise the market's configured value, otherwise the default. */
export function marketB(prior: readonly EstimateEntry[], market?: Pick<Market, 'lmsrB'>): number {
  const frozen = prior.find((e) => typeof e.fill?.b === 'number')?.fill?.b;
  return frozen ?? market?.lmsrB ?? defaultLiquidity.baseB;
}

export function lmsrStateFor(baseline: number, entries: readonly EstimateEntry[], b: number): LmsrState {
  return replay(baseline, b, entries.map((e) => ({ side: e.side, credits: e.amount })));
}

export function createLmsrRule(): CommunityEstimateRule {
  return {
    id: LMSR_RULE_ID,
    kind: 'market_price',
    compute(baseline, entries) {
      // No opening price, no market.
      if (baseline === null) return null;
      return yesPrice(lmsrStateFor(baseline, entries, marketB(entries)));
    },
    describeFill(baseline, prior, next, market) {
      if (baseline === null) throw new Error('LMSR needs an opening baseline');
      const b = marketB(prior, market);
      const before = lmsrStateFor(baseline, prior, b);
      const q = quoteTrade(before, next.side, next.amount);
      const fill: LmsrFill = {
        b,
        p0: yesPrice(openingState(baseline, b)),
        shares: q.shares,
        averagePrice: q.averagePrice,
        priceBefore: q.priceBefore,
        priceAfter: q.priceAfter,
      };
      return fill;
    },
  };
}

/**
 * Winners get 1 credit per share from the market maker, rounded down to whole
 * credits (the ledger is in whole credits); losers get nothing because their
 * credits already bought shares. VOID refunds are handled by the engine.
 */
export function createLmsrSettlement(): SettlementModel {
  return {
    id: LMSR_SETTLEMENT_ID,
    computePayouts({ outcome, forecasts }) {
      return forecasts.map((f) => {
        const shares = f.fill?.shares;
        if (typeof shares !== 'number' || !Number.isFinite(shares) || shares < 0) {
          throw new Error(`Forecast ${f.id} has no LMSR shares recorded`);
        }
        return { forecastId: f.id, payout: f.side === outcome ? Math.floor(shares) : 0 };
      });
    },
  };
}
