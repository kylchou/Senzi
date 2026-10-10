import { describe, expect, it } from "vitest";
import { liquidityFor, replay, yesPrice } from "@/lib/forecasting/lmsr";
import { openingPrice, pricesAfterTrades } from "@/lib/market-view/probability";
import { SIGNUP_GRANT_CREDITS } from "@/lib/types";

describe("market probability from trades", () => {
  it("opens at the baseline", () => {
    expect(openingPrice(0.3)).toBeCloseTo(0.3);
    expect(openingPrice(null)).toBeCloseTo(0.5);
  });

  it("moves up on YES and down on NO", () => {
    const [afterYes, afterNo] = pricesAfterTrades(0.4, [
      { side: "YES", credits: 100 },
      { side: "NO", credits: 200 },
    ]);
    expect(afterYes).toBeGreaterThan(0.4);
    expect(afterNo).toBeLessThan(afterYes!);
  });

  it("matches the forecasting engine's LMSR replay", () => {
    const trades = [
      { side: "YES" as const, credits: 50 },
      { side: "YES" as const, credits: 120 },
      { side: "NO" as const, credits: 80 },
    ];
    const b = liquidityFor({ startingBalance: SIGNUP_GRANT_CREDITS, lowConfidence: false });
    expect(pricesAfterTrades(0.35, trades).at(-1)).toBeCloseTo(yesPrice(replay(0.35, b, trades)), 10);
  });
});
