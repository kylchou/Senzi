/**
 * Fictional data and math for the tutorial, practice mode, and homepage demo.
 * Runs only in the browser: no API calls, no real credits, no real forecasts.
 * Prices use the same LMSR rule as real markets (lib/forecasting/lmsr.ts).
 */
import { openingState, quoteTrade, replay, yesPrice, type LmsrState } from "@/lib/forecasting/lmsr";

export type Side = "YES" | "NO";

export const PRACTICE_BALANCE = 500;

export const EXAMPLE_STARTUP = {
  name: "ExampleAI",
  tagline: "An AI note-taker for small teams",
  industry: "Software",
  stage: "Seed",
  about: "ExampleAI is a made-up company for this tutorial. It launched a public beta in June and says signups are growing every week.",
} as const;

export const EXAMPLE_MARKET = {
  question: "Will ExampleAI reach 10,000 monthly active users by December 31?",
  yesCriteria: "YES if ExampleAI publicly reports at least 10,000 monthly active users for any month ending on or before December 31.",
  noCriteria: "NO if no such report is published by December 31.",
  sources: ["ExampleAI blog", "ExampleAI investor updates"],
  deadline: "Dec 31",
  /** Model baseline the market opened at. */
  openingBaseline: 0.3,
  baselineMethodology: "Growth needed versus similar seed-stage tools' first six months.",
  /** Liquidity: lower than real markets so a practice trade visibly moves the price. */
  b: 400,
  forecasters: 23,
} as const;

/** Earlier (fictional) trades that moved the market to where the tutorial starts. */
export const EXAMPLE_HISTORY: { label: string; side: Side; credits: number; note?: string }[] = [
  { label: "Jul", side: "YES", credits: 60 },
  { label: "Aug", side: "YES", credits: 90, note: "Beta signups announced" },
  { label: "Sep", side: "NO", credits: 50 },
  { label: "Oct", side: "YES", credits: 80 },
  { label: "Nov", side: "NO", credits: 40, note: "Growth slowed" },
];

export const EXAMPLE_RESOLUTION = {
  outcome: "YES" as const,
  evidence: "ExampleAI's December update reported 11,400 monthly active users for November.",
  source: "ExampleAI investor update (fictional)",
};

/** Market state after the fictional history, before the visitor trades. */
export function startingState(): LmsrState {
  return replay(EXAMPLE_MARKET.openingBaseline, EXAMPLE_MARKET.b, EXAMPLE_HISTORY);
}

/** Price after each historical trade, for the chart. */
export function historyPoints(): { label: string; price: number; note?: string }[] {
  let s = openingState(EXAMPLE_MARKET.openingBaseline, EXAMPLE_MARKET.b);
  const points: { label: string; price: number; note?: string }[] = [{ label: "Open", price: yesPrice(s) }];
  for (const t of EXAMPLE_HISTORY) {
    s = quoteTrade(s, t.side, t.credits).stateAfter;
    points.push({ label: t.label, price: yesPrice(s), note: t.note });
  }
  return points;
}

export interface PracticeTrade {
  side: Side;
  credits: number;
  shares: number;
  priceBefore: number;
  priceAfter: number;
}

/** Applies the visitor's practice trades in order. */
export function applyPracticeTrades(trades: PracticeTrade[]): LmsrState {
  return replay(EXAMPLE_MARKET.openingBaseline, EXAMPLE_MARKET.b, [...EXAMPLE_HISTORY, ...trades]);
}

/** What spending `credits` on `side` would buy right now. Winning shares pay 1 credit each. */
export function practiceQuote(state: LmsrState, side: Side, credits: number) {
  const q = quoteTrade(state, side, credits);
  return { ...q, payoutIfRight: Math.floor(q.shares), profitIfRight: Math.floor(q.shares) - credits };
}

/** Whole practice credits from 1 to the balance; returns an error message or null. */
export function validatePracticeCredits(raw: string, balance: number): string | null {
  const value = raw.trim();
  if (value === "") return "Enter how many practice credits to use.";
  if (!/^\d+$/.test(value)) return "Use a whole number of credits.";
  if (Number(value) < 1) return "Use at least 1 credit.";
  if (Number(value) > balance) return `You only have ${balance} practice credits.`;
  return null;
}

/** Practice balance after trades and, once resolved, the payout on winning shares. */
export function practiceBalance(trades: PracticeTrade[], resolved: boolean): number {
  const spent = trades.reduce((sum, t) => sum + t.credits, 0);
  const won = resolved
    ? trades.filter((t) => t.side === EXAMPLE_RESOLUTION.outcome).reduce((sum, t) => sum + Math.floor(t.shares), 0)
    : 0;
  return PRACTICE_BALANCE - spent + won;
}
