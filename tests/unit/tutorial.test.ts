import { describe, expect, it } from "vitest";
import {
  allocationShare,
  PRACTICE_BALANCE,
  previewForecast,
  TUTORIAL_MARKET,
  TUTORIAL_STEPS,
  validatePracticeCredits,
} from "@/lib/tutorial/sandbox";

describe("tutorial sandbox", () => {
  it("computes the allocation share, which is not the baseline", () => {
    expect(allocationShare(TUTORIAL_MARKET.yesCredits, TUTORIAL_MARKET.noCredits)).toBe(0.42);
    expect(TUTORIAL_MARKET.openingBaseline).not.toBe(0.42);
    expect(allocationShare(0, 0)).toBeNull();
  });

  it("validates practice credits against the practice balance", () => {
    expect(validatePracticeCredits("50", PRACTICE_BALANCE)).toBeNull();
    expect(validatePracticeCredits("", PRACTICE_BALANCE)).toMatch(/Enter/);
    expect(validatePracticeCredits("2.5", PRACTICE_BALANCE)).toMatch(/whole/);
    expect(validatePracticeCredits("0", PRACTICE_BALANCE)).toMatch(/at least/);
    expect(validatePracticeCredits("501", PRACTICE_BALANCE)).toMatch(/only have 500/);
  });

  it("previews a pari-mutuel payout, rounded down", () => {
    // 100 on YES joins 420 YES vs 580 NO: 100/520 of the 580 NO pool = 111.5 -> 111.
    expect(previewForecast({ side: "YES", credits: 100, yesCredits: 420, noCredits: 580 })).toEqual({
      newShare: 520 / 1100,
      payoutIfRight: 211,
      profitIfRight: 111,
    });
    // NO side: 100/680 of the 420 YES pool = 61.7 -> 61.
    expect(previewForecast({ side: "NO", credits: 100, yesCredits: 420, noCredits: 580 }).payoutIfRight).toBe(161);
  });

  it("has one final step with no highlight", () => {
    expect(TUTORIAL_STEPS.at(-1)?.target).toBeNull();
    expect(new Set(TUTORIAL_STEPS.map((s) => s.id)).size).toBe(TUTORIAL_STEPS.length);
  });
});
