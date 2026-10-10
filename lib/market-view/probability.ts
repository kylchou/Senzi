import { applyTrade, liquidityFor, openingState, sharesForSpend, yesPrice } from "@/lib/forecasting/lmsr";
import { SIGNUP_GRANT_CREDITS } from "@/lib/types";

/**
 * Market probability is the LMSR price of a YES share. The forecasting engine
 * stores it on every snapshot (MarketSnapshot.generalEstimate). Older rows,
 * like the seeded demo trades, don't have it, and snapshots can't be edited,
 * so for those we replay the market's trades through the same LMSR math.
 */

/** Liquidity the engine uses for a market without a low-confidence model baseline. */
const DEFAULT_B = liquidityFor({ startingBalance: SIGNUP_GRANT_CREDITS, lowConfidence: false });

/** YES price after each trade, in order, starting from the opening baseline (or 50%). */
export function pricesAfterTrades(
  openingBaseline: number | null,
  trades: ReadonlyArray<{ side: "YES" | "NO"; credits: number }>,
  b: number = DEFAULT_B,
): number[] {
  let state = openingState(openingBaseline ?? 0.5, b);
  return trades.map((trade) => {
    state = applyTrade(state, trade.side, sharesForSpend(state, trade.side, trade.credits));
    return yesPrice(state);
  });
}

/** The price a market opens at: its baseline, or even odds without one. */
export function openingPrice(openingBaseline: number | null): number {
  return yesPrice(openingState(openingBaseline ?? 0.5, DEFAULT_B));
}
