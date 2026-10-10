/** The guided tutorial: what each step highlights and what the visitor has to do. */

import { formatShare } from "@/lib/market-view/format";
import type { PracticeTrade, Side } from "./sandbox";

export type Target = "startup" | "question" | "market" | "forecast" | "credits" | "review" | "chart" | "outcome";

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  /** Element to highlight, or null for a centered card. */
  target: Target | null;
  /** Short instruction shown when the step's action isn't done yet. */
  todo?: string;
  /** Feedback on what the visitor did, once there's something to say. */
  feedback?: (ctx: StepContext) => string | null;
}

export interface StepContext {
  side: Side | null;
  estimate: number | null;
  trades: PracticeTrade[];
  /** Current market probability of YES. */
  price: number;
  resolved: boolean;
}

function compare(estimate: number, price: number) {
  const gap = Math.round(estimate - price * 100);
  if (Math.abs(gap) <= 2) return "Your estimate is about the same as the market.";
  return gap > 0 ? `You're ${gap} points more optimistic than the market.` : `You're ${-gap} points more skeptical than the market.`;
}

export const STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to Senzi",
    body: "People forecast YES/NO questions about startups using virtual credits, and Senzi shows what the crowd expects. This is a made-up startup, so try anything.",
    target: "startup",
  },
  {
    id: "question",
    title: "Read the question",
    body: "A good question has a measurable outcome, a deadline, and sources everyone agrees on in advance. Open the resolution rules.",
    target: "question",
    todo: "Open “How it resolves”.",
  },
  {
    id: "market",
    title: "Explore the market",
    body: "The model baseline is where the market opened. The market probability is where trading has pushed it since. Both can move as news and people arrive.",
    target: "market",
  },
  {
    id: "forecast",
    title: "Make a forecast",
    body: "Pick YES or NO and set how likely you think YES is. A forecast is an estimate, not a certainty.",
    target: "forecast",
    todo: "Pick a side and move the slider.",
    feedback: ({ side, estimate, price }) => {
      if (!side || estimate === null) return null;
      const fits = side === "YES" ? estimate > price * 100 : estimate < price * 100;
      return `${compare(estimate, price)} ${fits ? `Buying ${side} matches that view.` : `Heads up: your estimate points to ${side === "YES" ? "NO" : "YES"}, not ${side}.`}`;
    },
  },
  {
    id: "credits",
    title: "Use practice credits",
    body: "Spend credits to buy shares. A winning share pays 1 credit, so cheaper shares pay more if you're right. These are practice credits only.",
    target: "credits",
    todo: "Choose an amount and place the practice forecast.",
    feedback: ({ trades }) => {
      const t = trades.at(-1);
      if (!t) return null;
      return `${t.credits} credits bought ${t.shares.toFixed(1)} ${t.side} shares and moved the market from ${formatShare(t.priceBefore)} to ${formatShare(t.priceAfter)}. If ${t.side} wins, they pay ${Math.floor(t.shares)} credits.`;
    },
  },
  {
    id: "review",
    title: "Review your forecast",
    body: "Compare your estimate with the market. You can buy more, or buy the other side, before the deadline.",
    target: "review",
    feedback: ({ estimate, price }) => (estimate === null ? null : compare(estimate, price)),
  },
  {
    id: "chart",
    title: "Watch it evolve",
    body: "Every trade is saved as a snapshot, so you can see how expectations changed over time and why.",
    target: "chart",
  },
  {
    id: "outcome",
    title: "See the outcome",
    body: "After the deadline, one admin proposes the outcome with evidence and a second admin approves it against the criteria. Then shares pay out. Forecasts are research signals, not guarantees or financial advice.",
    target: "outcome",
    todo: "Fast-forward to the deadline.",
    feedback: ({ resolved, trades }) => {
      if (!resolved) return null;
      const sides = new Set(trades.map((t) => t.side));
      if (sides.size === 0) return "It resolved YES. You sat this one out, which is fine.";
      if (!sides.has("YES")) return "It resolved YES, so your NO shares pay nothing. Being wrong sometimes is normal; what counts is being well calibrated over many questions.";
      return "It resolved YES, so each YES share paid 1 credit.";
    },
  },
  {
    id: "done",
    title: "You've got it",
    body: "You read a question, made a forecast, used credits, and saw it resolve. Keep playing in practice mode, or try a real market.",
    target: null,
  },
];
