import {
  applyPracticeTrades,
  practiceBalance,
  practiceQuote,
  validatePracticeCredits,
  type PracticeTrade,
  type Side,
} from "./sandbox";
import { STEPS } from "./steps";

/** Tutorial and practice-mode state. Lives in the browser only. */
export interface TutorialState {
  mode: "intro" | "guided" | "sandbox";
  step: number;
  rulesOpen: boolean;
  side: Side | null;
  /** The visitor's own probability of YES, 1-99. */
  estimate: number | null;
  amount: string;
  trades: PracticeTrade[];
  resolved: boolean;
}

export const initialState: TutorialState = {
  mode: "intro",
  step: 0,
  rulesOpen: false,
  side: null,
  estimate: null,
  amount: "",
  trades: [],
  resolved: false,
};

export type TutorialAction =
  | { type: "start"; step?: number }
  | { type: "next" }
  | { type: "back" }
  | { type: "skip" }
  | { type: "exit" }
  | { type: "restart" }
  | { type: "practice" }
  | { type: "resetPractice" }
  | { type: "toggleRules" }
  | { type: "side"; side: Side }
  | { type: "estimate"; value: number }
  | { type: "amount"; value: string }
  | { type: "trade" }
  | { type: "resolve" };

const practiceReset = {
  rulesOpen: false,
  side: null,
  estimate: null,
  amount: "",
  trades: [],
  resolved: false,
} satisfies Partial<TutorialState>;

const lastStep = STEPS.length - 1;

export function balanceOf(s: TutorialState) {
  return practiceBalance(s.trades, s.resolved);
}

export function amountError(s: TutorialState) {
  return validatePracticeCredits(s.amount, balanceOf(s));
}

/** Whether the current step's action is done (steps without one are always done). */
export function stepDone(s: TutorialState, step = s.step): boolean {
  switch (STEPS[step]?.id) {
    case "question":
      return s.rulesOpen;
    case "forecast":
      return s.side !== null && s.estimate !== null;
    case "credits":
      return s.trades.length > 0;
    case "outcome":
      return s.resolved;
    default:
      return true;
  }
}

export function tutorialReducer(s: TutorialState, a: TutorialAction): TutorialState {
  switch (a.type) {
    case "start":
      return { ...s, mode: "guided", step: Math.min(Math.max(a.step ?? 0, 0), lastStep) };
    case "next":
      return stepDone(s) ? { ...s, step: Math.min(s.step + 1, lastStep) } : s;
    case "back":
      return { ...s, step: Math.max(s.step - 1, 0) };
    case "skip":
      return { ...s, step: Math.min(s.step + 1, lastStep) };
    case "exit":
      return { ...s, mode: "intro" };
    case "restart":
      return { ...initialState, mode: "guided" };
    case "practice":
      return { ...s, ...practiceReset, mode: "sandbox" };
    case "resetPractice":
      return { ...s, ...practiceReset };
    case "toggleRules":
      return { ...s, rulesOpen: !s.rulesOpen };
    case "side":
      return s.resolved ? s : { ...s, side: a.side };
    case "estimate":
      return s.resolved ? s : { ...s, estimate: Math.min(99, Math.max(1, Math.round(a.value))) };
    case "amount":
      return s.resolved ? s : { ...s, amount: a.value };
    case "trade": {
      if (s.resolved || !s.side || amountError(s)) return s;
      const q = practiceQuote(applyPracticeTrades(s.trades), s.side, Number(s.amount));
      const trade: PracticeTrade = {
        side: s.side,
        credits: q.credits,
        shares: q.shares,
        priceBefore: q.priceBefore,
        priceAfter: q.priceAfter,
      };
      return { ...s, trades: [...s.trades, trade], amount: "" };
    }
    case "resolve":
      return { ...s, resolved: true };
  }
}
