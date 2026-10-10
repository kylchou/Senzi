"use client";

import { useState } from "react";
import { ArrowRight, CalendarClock, FlaskConical } from "lucide-react";
import { PriceBar } from "@/components/tutorial/DemoMarket";
import { ButtonLink } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { yesPrice } from "@/lib/forecasting/lmsr";
import { formatShare } from "@/lib/market-view/format";
import { EXAMPLE_MARKET, EXAMPLE_STARTUP, startingState, type Side } from "@/lib/tutorial/sandbox";

const MARKET_PRICE = yesPrice(startingState());

function message(side: Side | null, gap: number) {
  if (Math.abs(gap) <= 2) return "You agree with the sample market. Drag to disagree.";
  const view = gap > 0 ? `You're ${gap} points more optimistic than the market.` : `You're ${-gap} points more skeptical than the market.`;
  const fits = gap > 0 ? "YES" : "NO";
  if (side && side !== fits) return `${view} That points to ${fits}, not ${side}.`;
  return `${view} On Senzi, you'd buy ${fits}.`;
}

/** Hero sample card: pick a side, move your estimate, compare with a sample market. Local only. */
export function HeroDemo() {
  const [side, setSide] = useState<Side | null>(null);
  const [estimate, setEstimate] = useState(50);
  const market = Math.round(MARKET_PRICE * 100);

  return (
    <div className="rounded-2xl bg-surface p-5 text-left text-ink-900 shadow-[var(--shadow-lift)] ring-1 ring-hairline sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/30">
          <FlaskConical className="size-3.5" aria-hidden /> Example · not live data
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-ink-600">
          <CalendarClock className="size-3.5" aria-hidden /> Closes {EXAMPLE_MARKET.deadline}
        </span>
      </div>
      <p className="mt-3 text-xs text-ink-600">
        {EXAMPLE_STARTUP.name} · {EXAMPLE_STARTUP.tagline}
      </p>
      <p className="mt-1 font-display text-lg font-semibold leading-snug">{EXAMPLE_MARKET.question}</p>

      <fieldset className="mt-4 grid grid-cols-2 gap-2">
        <legend className="sr-only">Your side</legend>
        {(["YES", "NO"] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={cn(
              "h-10 rounded-full border text-sm font-bold transition-colors active:scale-[0.98]",
              side === s
                ? s === "YES"
                  ? "border-red-600 bg-red-600 text-white"
                  : "border-ink-900 bg-ink-900 text-surface"
                : "border-ink-200 text-ink-700 hover:bg-ink-50",
            )}
          >
            {s}
          </button>
        ))}
      </fieldset>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <p className="font-display text-3xl font-bold tabular-nums">{estimate}%</p>
          <p className="text-xs text-ink-600">Your estimate</p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-semibold tabular-nums text-ink-700">{formatShare(MARKET_PRICE)}</p>
          <p className="text-xs text-ink-600">Sample market probability</p>
        </div>
      </div>
      <PriceBar price={MARKET_PRICE} estimate={estimate} />
      <label htmlFor="hero-estimate" className="sr-only">
        Your estimate that YES happens
      </label>
      <input
        id="hero-estimate"
        type="range"
        min={1}
        max={99}
        value={estimate}
        onChange={(e) => setEstimate(Number(e.target.value))}
        aria-valuetext={`${estimate}% chance of YES`}
        className="mt-2 w-full accent-red-600"
      />
      <p className="mt-1 min-h-10 text-sm text-ink-700" aria-live="polite">
        {message(side, estimate - market)}
      </p>
      <ButtonLink href="/how-it-works" variant="primary" size="sm" className="mt-3">
        Try the full tutorial <ArrowRight className="size-4" aria-hidden />
      </ButtonLink>
    </div>
  );
}
