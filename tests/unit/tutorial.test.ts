import { afterEach, describe, expect, it, vi } from "vitest";
import { yesPrice } from "@/lib/forecasting/lmsr";
import { initialState, stepDone, tutorialReducer, type TutorialAction, type TutorialState } from "@/lib/tutorial/engine";
import { loadProgress, saveProgress } from "@/lib/tutorial/progress";
import {
  applyPracticeTrades,
  EXAMPLE_MARKET,
  PRACTICE_BALANCE,
  practiceBalance,
  practiceQuote,
  startingState,
  validatePracticeCredits,
} from "@/lib/tutorial/sandbox";
import { STEPS } from "@/lib/tutorial/steps";

const run = (actions: TutorialAction[], from: TutorialState = initialState) => actions.reduce(tutorialReducer, from);
const stepIndex = (id: string) => STEPS.findIndex((s) => s.id === id);

describe("practice market math", () => {
  it("starts above the baseline after the fictional history", () => {
    expect(yesPrice(startingState())).toBeGreaterThan(EXAMPLE_MARKET.openingBaseline);
  });

  it("pays 1 credit per winning share, rounded down", () => {
    const q = practiceQuote(startingState(), "YES", 100);
    expect(q.payoutIfRight).toBe(Math.floor(q.shares));
    expect(q.priceAfter).toBeGreaterThan(q.priceBefore);
  });

  it("tracks the practice balance through trades and payout", () => {
    const q = practiceQuote(startingState(), "YES", 100);
    const trade = { side: "YES" as const, credits: 100, shares: q.shares, priceBefore: q.priceBefore, priceAfter: q.priceAfter };
    expect(practiceBalance([trade], false)).toBe(PRACTICE_BALANCE - 100);
    expect(practiceBalance([trade], true)).toBe(PRACTICE_BALANCE - 100 + Math.floor(q.shares));
    expect(yesPrice(applyPracticeTrades([trade]))).toBeCloseTo(q.priceAfter);
  });

  it("validates practice credits", () => {
    expect(validatePracticeCredits("50", 500)).toBeNull();
    expect(validatePracticeCredits("", 500)).toMatch(/Enter/);
    expect(validatePracticeCredits("2.5", 500)).toMatch(/whole/);
    expect(validatePracticeCredits("0", 500)).toMatch(/at least/);
    expect(validatePracticeCredits("501", 500)).toMatch(/only have 500/);
  });
});

describe("tutorial engine", () => {
  it("waits for the step's action before Next works, but Skip always moves on", () => {
    const atQuestion = run([{ type: "start", step: stepIndex("question") }]);
    expect(run([{ type: "next" }], atQuestion).step).toBe(stepIndex("question"));
    expect(run([{ type: "skip" }], atQuestion).step).toBe(stepIndex("question") + 1);
    expect(run([{ type: "toggleRules" }, { type: "next" }], atQuestion).step).toBe(stepIndex("question") + 1);
  });

  it("places a practice trade only with a side and a valid amount", () => {
    const s = run([{ type: "start" }, { type: "amount", value: "50" }, { type: "trade" }]);
    expect(s.trades).toHaveLength(0);
    const traded = run([{ type: "side", side: "NO" }, { type: "trade" }], s);
    expect(traded.trades).toEqual([expect.objectContaining({ side: "NO", credits: 50 })]);
    expect(traded.amount).toBe("");
    expect(run([{ type: "amount", value: "9999" }, { type: "trade" }], traded).trades).toHaveLength(1);
  });

  it("goes back, and restart clears everything", () => {
    const s = run([{ type: "start", step: 3 }, { type: "back" }, { type: "side", side: "YES" }]);
    expect(s.step).toBe(2);
    expect(run([{ type: "restart" }], s)).toEqual({ ...initialState, mode: "guided" });
  });

  it("practice mode starts fresh and reset restores the demo", () => {
    const played = run([{ type: "practice" }, { type: "side", side: "YES" }, { type: "amount", value: "25" }, { type: "trade" }, { type: "resolve" }]);
    expect(played.mode).toBe("sandbox");
    expect(played.resolved).toBe(true);
    // Resolved markets can't be traded.
    expect(run([{ type: "amount", value: "25" }, { type: "trade" }], played).trades).toHaveLength(1);
    expect(run([{ type: "resetPractice" }], played)).toMatchObject({ trades: [], resolved: false, side: null, mode: "sandbox" });
  });

  it("marks only action steps as needing work", () => {
    expect(stepDone(initialState, stepIndex("welcome"))).toBe(true);
    expect(stepDone(initialState, stepIndex("forecast"))).toBe(false);
    expect(stepDone(run([{ type: "side", side: "YES" }, { type: "estimate", value: 140 }]), stepIndex("forecast"))).toBe(true);
    expect(run([{ type: "estimate", value: 140 }]).estimate).toBe(99);
  });
});

describe("saved progress", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips and ignores bad data", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    saveProgress({ step: 4, completed: false });
    expect(loadProgress()).toEqual({ step: 4, completed: false });
    store.set("senzi-tutorial-v1", "{nope");
    expect(loadProgress()).toBeNull();
  });

  it("works when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    });
    expect(() => saveProgress({ step: 1, completed: false })).not.toThrow();
    expect(loadProgress()).toBeNull();
  });
});
