/**
 * Data and math for the "How it works" practice walkthrough on the homepage.
 *
 * Everything here is fictional and runs only in the browser: no API calls,
 * no real credits, no real forecasts.
 */

export const PRACTICE_BALANCE = 500;

export const TUTORIAL_STARTUP = {
  name: "Fernhill Robotics",
  tagline: "Warehouse robots that fit in a shipping container",
  industry: "Robotics",
  stage: "Seed",
  headquarters: "Denver, CO",
  about:
    "Fernhill builds compact picking robots that small warehouses can rent by the month. It raised a $3M seed round last year and says it's talking to Series A investors.",
} as const;

export const TUTORIAL_MARKET = {
  question: "Will Fernhill Robotics announce a Series A of at least $10M by March 31, 2027?",
  yesCriteria:
    "YES if Fernhill or its lead investor publicly announces a priced Series A of $10M or more on or before March 31, 2027.",
  noCriteria: "NO if no qualifying round is announced by that date.",
  sources: ["Fernhill press releases", "Lead investor announcements", "SEC Form D filings"],
  openingBaseline: 0.35,
  baselineMethodology: "Share of seed-stage robotics companies that raised a $10M+ Series A within 18 months.",
  yesCredits: 420,
  noCredits: 580,
  forecasters: 37,
  deadline: "Mar 31, 2027",
} as const;

export const TUTORIAL_RESOLUTION = {
  outcome: "YES" as const,
  evidence: "Fernhill announced a $12M Series A led by a logistics-focused fund on February 18, 2027.",
  evidenceSource: "Fernhill press release (fictional)",
};

export type Side = "YES" | "NO";

/** YES credits as a share of all credits. Not a probability. */
export function allocationShare(yesCredits: number, noCredits: number): number | null {
  const total = yesCredits + noCredits;
  return total > 0 ? yesCredits / total : null;
}

/** Whole practice credits between 1 and the balance; returns an error message or null. */
export function validatePracticeCredits(raw: string, balance: number): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "Enter how many practice credits to use.";
  if (!/^\d+$/.test(trimmed)) return "Use a whole number of credits.";
  const value = Number(trimmed);
  if (value < 1) return "Use at least 1 credit.";
  if (value > balance) return `You only have ${balance} practice credits.`;
  return null;
}

export interface ForecastPreview {
  /** YES allocation share after this forecast. */
  newShare: number;
  /** Credits returned if this side wins: the stake plus a share of the other side's pool. */
  payoutIfRight: number;
  profitIfRight: number;
}

/**
 * Pari-mutuel preview: if your side wins you get your stake back plus a share
 * of the losing side's credits proportional to your stake, rounded down.
 * Later forecasts change the pools, so this is an estimate at entry.
 */
export function previewForecast(input: { side: Side; credits: number; yesCredits: number; noCredits: number }): ForecastPreview {
  const yes = input.yesCredits + (input.side === "YES" ? input.credits : 0);
  const no = input.noCredits + (input.side === "NO" ? input.credits : 0);
  const sameSide = input.side === "YES" ? yes : no;
  const otherSide = input.side === "YES" ? no : yes;
  const winnings = sameSide > 0 ? Math.floor((input.credits / sameSide) * otherSide) : 0;
  return {
    newShare: yes / (yes + no),
    payoutIfRight: input.credits + winnings,
    profitIfRight: winnings,
  };
}

export interface TutorialStep {
  id: string;
  /** Which part of the practice market is highlighted. */
  target: "startup" | "question" | "numbers" | "side" | "confidence" | "credits" | "submit" | "resolution" | null;
  title: string;
  body: string;
  /** Short pointer shown next to the highlighted element. */
  hint?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "startup",
    target: "startup",
    title: "Meet the startup",
    body: "Every market is about a real, specific startup. Here we'll use a made-up one. Tap the startup card to read about it.",
    hint: "Tap to open",
  },
  {
    id: "question",
    target: "question",
    title: "Read the question",
    body: "Markets ask a YES or NO question with a deadline. Before forecasting, check exactly what counts. Open “How it resolves”.",
    hint: "Open the rules",
  },
  {
    id: "numbers",
    target: "numbers",
    title: "Read the numbers",
    body: "Senzi shows different numbers that are easy to mix up. Which one shows how the community's credits are split right now?",
  },
  {
    id: "side",
    target: "side",
    title: "Pick a side",
    body: "Do you think Fernhill will raise its Series A in time? Choose YES or NO. There's no wrong answer in practice mode.",
    hint: "Choose one",
  },
  {
    id: "confidence",
    target: "confidence",
    title: "Say how sure you are",
    body: "Optionally, tell us how likely you think YES is. It doesn't change your payout, but it's how Senzi measures how well calibrated you are over time. Move the slider.",
    hint: "Drag me",
  },
  {
    id: "credits",
    target: "credits",
    title: "Allocate practice credits",
    body: "Choose how many credits to put behind your answer. The preview shows what you'd get back if you're right. These are practice credits, not your real balance.",
    hint: "Pick an amount",
  },
  {
    id: "submit",
    target: "submit",
    title: "Place your practice forecast",
    body: "Submit it and watch the community allocation move. In the real app, this is when your credits are set aside.",
    hint: "Submit",
  },
  {
    id: "resolution",
    target: "resolution",
    title: "See how it resolves",
    body: "After the deadline, an admin proposes the outcome with evidence and a second admin approves it. Then credits are paid out. Fast-forward to see it.",
    hint: "Fast-forward",
  },
  {
    id: "done",
    target: null,
    title: "That's Senzi",
    body: "You read a question, picked a side, allocated credits, and saw a market resolve. Real markets work the same way, with real virtual credits.",
  },
];
