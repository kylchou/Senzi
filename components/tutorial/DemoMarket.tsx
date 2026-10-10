"use client";

import { type Dispatch, type ReactNode } from "react";
import { Building2, Check, ChevronDown, FastForward, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { yesPrice } from "@/lib/forecasting/lmsr";
import { formatShare } from "@/lib/market-view/format";
import { amountError, balanceOf, type TutorialAction, type TutorialState } from "@/lib/tutorial/engine";
import {
  applyPracticeTrades,
  EXAMPLE_MARKET,
  EXAMPLE_RESOLUTION,
  EXAMPLE_STARTUP,
  historyPoints,
  practiceQuote,
} from "@/lib/tutorial/sandbox";
import type { Target } from "@/lib/tutorial/steps";

const PRESETS = [25, 50, 100, 200];

const LABELS: Record<Target, string> = {
  startup: "The startup",
  question: "The question",
  market: "Market numbers",
  forecast: "Your forecast",
  credits: "Practice credits",
  review: "Your practice positions",
  chart: "Price history",
  outcome: "Outcome",
};

/**
 * A fictional practice market used by the guided tutorial and practice mode.
 * Every action stays in local state; nothing is sent to the server.
 */
export function DemoMarket({
  state,
  dispatch,
  highlight,
}: {
  state: TutorialState;
  dispatch: Dispatch<TutorialAction>;
  /** Part to highlight during the guided tutorial; others are dimmed. */
  highlight: Target | null | undefined;
}) {
  const market = applyPracticeTrades(state.trades);
  const price = yesPrice(market);
  const balance = balanceOf(state);
  const error = state.amount ? amountError(state) : null;
  const quote = state.side && state.amount && !error ? practiceQuote(market, state.side, Number(state.amount)) : null;
  const yesShares = state.trades.filter((t) => t.side === "YES").reduce((n, t) => n + t.shares, 0);
  const noShares = state.trades.filter((t) => t.side === "NO").reduce((n, t) => n + t.shares, 0);
  const payout = state.resolved ? Math.floor(EXAMPLE_RESOLUTION.outcome === "YES" ? yesShares : noShares) : 0;
  const spent = state.trades.reduce((n, t) => n + t.credits, 0);
  const guided = highlight !== undefined;

  const part = (id: Target) => ({ id, highlight, guided });

  return (
    <div className="rounded-[var(--radius-card)] bg-surface p-4 shadow-[var(--shadow-lift)] ring-1 ring-hairline sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30">
          <FlaskConical className="size-3.5" aria-hidden /> Practice mode · fictional data
        </span>
        <span className="text-xs text-ink-600 tabular-nums" aria-live="polite">
          Practice balance <strong className="text-ink-900">{balance}</strong> credits
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Part {...part("startup")}>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-ink-900 text-surface">
              <Building2 className="size-5" aria-hidden />
            </span>
            <div>
              <p className="font-display font-semibold text-ink-900">{EXAMPLE_STARTUP.name}</p>
              <p className="text-sm text-ink-600">{EXAMPLE_STARTUP.tagline}</p>
              <p className="mt-2 text-sm text-ink-700">{EXAMPLE_STARTUP.about}</p>
            </div>
          </div>
        </Part>

        <Part {...part("question")}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">Closes {EXAMPLE_MARKET.deadline}</p>
          <h3 className="mt-1 text-lg font-bold leading-snug text-ink-900">{EXAMPLE_MARKET.question}</h3>
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleRules" })}
            aria-expanded={state.rulesOpen}
            className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-ink-700 hover:text-ink-900"
          >
            How it resolves
            <ChevronDown className={cn("size-4 transition-transform", state.rulesOpen && "rotate-180")} aria-hidden />
          </button>
          {state.rulesOpen && (
            <div className="mt-1 animate-[tutorial-in_250ms_ease-out] space-y-1.5 rounded-lg bg-ink-50 p-3 text-sm text-ink-700">
              <p>{EXAMPLE_MARKET.yesCriteria}</p>
              <p>{EXAMPLE_MARKET.noCriteria}</p>
              <p className="text-xs text-ink-500">Sources: {EXAMPLE_MARKET.sources.join(" · ")}</p>
            </div>
          )}
        </Part>

        <Part {...part("market")}>
          <div className="grid grid-cols-2 gap-3">
            <Figure label="Model baseline (at open)" value={formatShare(EXAMPLE_MARKET.openingBaseline)} />
            <Figure label="Market probability (all users)" value={formatShare(price)} strong />
          </div>
          <PriceBar price={price} estimate={state.estimate} baseline={EXAMPLE_MARKET.openingBaseline} />
          <p className="mt-2 text-xs text-ink-500">
            {EXAMPLE_MARKET.forecasters + state.trades.length} practice forecasters · baseline: {EXAMPLE_MARKET.baselineMethodology}
          </p>
        </Part>

        <Part {...part("forecast")}>
          <fieldset disabled={state.resolved}>
            <legend className="text-sm font-semibold text-ink-900">Your forecast</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["YES", "NO"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  aria-pressed={state.side === side}
                  onClick={() => dispatch({ type: "side", side })}
                  className={cn(
                    "h-11 rounded-full border text-sm font-bold transition-colors",
                    state.side === side
                      ? side === "YES"
                        ? "border-red-600 bg-red-600 text-white"
                        : "border-ink-900 bg-ink-900 text-surface"
                      : "border-ink-200 text-ink-700 hover:bg-ink-50",
                  )}
                >
                  {side}
                </button>
              ))}
            </div>
            <label htmlFor="practice-estimate" className="mt-4 block text-sm font-semibold text-ink-900">
              How likely is YES?
            </label>
            <input
              id="practice-estimate"
              type="range"
              min={1}
              max={99}
              value={state.estimate ?? 50}
              onChange={(e) => dispatch({ type: "estimate", value: Number(e.target.value) })}
              aria-valuetext={state.estimate === null ? "Not set" : `${state.estimate}% chance of YES`}
              className="mt-2 w-full accent-red-600"
            />
            <p className="text-xs text-ink-600" aria-live="polite">
              {state.estimate === null ? "Not set yet" : `You think ${state.estimate}% · market says ${Math.round(price * 100)}%`}
            </p>
          </fieldset>
        </Part>

        <Part {...part("credits")}>
          <label htmlFor="practice-credits" className="text-sm font-semibold text-ink-900">
            Practice credits
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={state.resolved}
                onClick={() => dispatch({ type: "amount", value: String(p) })}
                className={cn(
                  "h-10 min-w-12 rounded-full border px-3 text-sm font-semibold tabular-nums transition-colors disabled:opacity-50",
                  state.amount === String(p) ? "border-ink-900 bg-ink-900 text-surface" : "border-ink-200 text-ink-700 hover:bg-ink-50",
                )}
              >
                {p}
              </button>
            ))}
            <input
              id="practice-credits"
              inputMode="numeric"
              placeholder="Other"
              value={state.amount}
              disabled={state.resolved}
              onChange={(e) => dispatch({ type: "amount", value: e.target.value })}
              aria-invalid={!!error}
              aria-describedby="practice-credits-help"
              className="h-10 w-24 rounded-full border border-ink-200 bg-surface px-3 text-sm tabular-nums"
            />
          </div>
          <p id="practice-credits-help" className={cn("mt-2 text-xs", error ? "text-red-700" : "text-ink-600")}>
            {error ??
              (!state.side
                ? "Pick YES or NO first."
                : quote
                  ? `${quote.shares.toFixed(1)} ${state.side} shares at ${formatShare(quote.averagePrice)} each. If ${state.side} is right you get ${quote.payoutIfRight} credits back.`
                  : "Choose an amount to see what it buys.")}
          </p>
          <Button
            variant="accent"
            className="mt-3 w-full"
            disabled={!quote || state.resolved}
            onClick={() => dispatch({ type: "trade" })}
          >
            Place practice forecast
          </Button>
        </Part>

        <Part {...part("review")}>
          <p className="text-sm font-semibold text-ink-900">Your practice positions</p>
          {state.trades.length === 0 ? (
            <p className="mt-2 text-sm text-ink-600">Nothing yet. Place a practice forecast to see it here.</p>
          ) : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {state.trades.map((t, i) => (
                <li key={i} className="flex justify-between gap-3 rounded-lg bg-ink-50 px-3 py-2 tabular-nums">
                  <span>
                    {t.credits} on <strong>{t.side}</strong> · {t.shares.toFixed(1)} shares
                  </span>
                  <span className="text-ink-600">moved {formatShare(t.priceBefore)} → {formatShare(t.priceAfter)}</span>
                </li>
              ))}
            </ul>
          )}
          {state.estimate !== null && (
            <p className="mt-2 text-xs text-ink-600">
              {Math.abs(state.estimate - Math.round(price * 100)) <= 2
                ? "Your estimate is close to the market."
                : state.estimate > price * 100
                  ? `You're ${Math.round(state.estimate - price * 100)} points more optimistic than the market.`
                  : `You're ${Math.round(price * 100 - state.estimate)} points more skeptical than the market.`}
            </p>
          )}
        </Part>

        <Part {...part("chart")} className="lg:col-span-2">
          <p className="text-sm font-semibold text-ink-900">Market probability over time</p>
          <MiniChart extra={state.trades.map((t) => t.priceAfter)} />
        </Part>

        <Part {...part("outcome")} className="lg:col-span-2">
          {state.resolved ? (
            <div className="animate-[tutorial-in_250ms_ease-out] space-y-2 text-sm">
              <p className="font-semibold text-ink-900">
                Resolved <span className="text-red-700">{EXAMPLE_RESOLUTION.outcome}</span> · checked against the criteria and approved by two admins
              </p>
              <p className="text-ink-700">{EXAMPLE_RESOLUTION.evidence}</p>
              <p className="text-xs text-ink-500">Evidence: {EXAMPLE_RESOLUTION.source}</p>
              <p className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-2 font-medium text-ink-800">
                <Check className="size-4 shrink-0 text-emerald-600" aria-hidden />
                {state.trades.length === 0
                  ? "You didn't place a practice forecast this time."
                  : `You spent ${spent} practice credits and got ${payout} back (${payout - spent >= 0 ? "+" : ""}${payout - spent}).`}
              </p>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => dispatch({ type: "resolve" })}>
              <FastForward className="size-4" aria-hidden /> Fast-forward to the deadline
            </Button>
          )}
        </Part>
      </div>
    </div>
  );
}

/** One highlightable part of the practice market. */
function Part({
  id,
  highlight,
  guided,
  className,
  children,
}: {
  id: Target;
  highlight: Target | null | undefined;
  guided: boolean;
  className?: string;
  children: ReactNode;
}) {
  const active = highlight === id;
  return (
    <section
      data-tutorial-target={id}
      aria-label={LABELS[id]}
      className={cn(
        "scroll-mt-28 rounded-xl p-3 ring-1 ring-hairline transition-[box-shadow,filter] duration-300",
        active && "relative z-10 shadow-[0_0_0_3px_var(--color-red-500),0_0_0_9px_rgb(255_44_44/0.12)]",
        guided && !active && "grayscale",
        className,
      )}
    >
      {children}
    </section>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className={cn("font-display font-bold tabular-nums text-ink-900", strong ? "text-3xl" : "text-xl text-ink-700")}>{value}</p>
      <p className="text-xs text-ink-600">{label}</p>
    </div>
  );
}

/** Market price as a bar, with the baseline and the visitor's own estimate marked. */
export function PriceBar({ price, estimate, baseline }: { price: number; estimate: number | null; baseline?: number }) {
  const label =
    `Market probability ${formatShare(price)}` +
    (baseline !== undefined ? `, model baseline ${formatShare(baseline)}` : "") +
    (estimate !== null ? `, your estimate ${estimate}%` : "");
  return (
    <div role="img" aria-label={label} className="relative mt-3 h-6">
      <div className="absolute inset-x-0 top-2 h-2 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-red-500 transition-[width] duration-500" style={{ width: `${price * 100}%` }} />
      </div>
      {baseline !== undefined && (
        <span aria-hidden className="absolute top-0.5 h-5 w-0.5 -translate-x-1/2 rounded-full bg-ink-500" style={{ left: `${baseline * 100}%` }} />
      )}
      {estimate !== null && (
        <span
          aria-hidden
          className="absolute top-0 size-6 -translate-x-1/2 rounded-full border-2 border-surface bg-ink-900 shadow transition-[left] duration-300"
          style={{ left: `${estimate}%` }}
        />
      )}
    </div>
  );
}

function MiniChart({ extra }: { extra: number[] }) {
  const points = [...historyPoints(), ...extra.map((price, i) => ({ label: i === 0 ? "You" : "", price, note: undefined }))];
  const w = 600;
  const h = 140;
  const x = (i: number) => 24 + (i * (w - 48)) / Math.max(points.length - 1, 1);
  const y = (p: number) => 12 + (1 - p) * (h - 36);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const first = points[0]!.price;
  const last = points.at(-1)!.price;
  return (
    <figure className="mt-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`Market probability went from ${formatShare(first)} at open to ${formatShare(last)} now.`}>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1="24" x2={w - 24} y1={y(g)} y2={y(g)} className="stroke-ink-200" strokeDasharray="3 4" />
        ))}
        <path d={path} fill="none" className="stroke-red-500" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.price)} r={i >= points.length - extra.length ? 6 : 4} className={i >= points.length - extra.length ? "fill-ink-900" : "fill-red-500"} />
            {p.label && (
              <text x={x(i)} y={h - 4} textAnchor="middle" className="fill-ink-500 text-[11px]">
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="text-xs text-ink-600">
        {points.filter((p) => p.note).map((p) => `${p.label}: ${p.note}`).join(" · ")}
        {extra.length > 0 && " · Dark dots are your practice trades."}
      </figcaption>
    </figure>
  );
}
