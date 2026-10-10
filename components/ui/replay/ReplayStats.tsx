"use client";

import { SERIES, type ReplayPoint, type SeriesKey } from "@/lib/market-view/replay";
import { cn } from "../cn";
import { percent, points, SERIES_STYLE } from "./series";
import { useSmoothed } from "./useReplayClock";

function Stat({ series, value, start, available }: { series: SeriesKey; value: number | null; start: number | null; available: boolean }) {
  const shown = useSmoothed(value);
  const style = SERIES_STYLE[series];
  const delta = value !== null && start !== null ? value - start : null;
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-500">
        <span aria-hidden className={cn("w-5", style.swatch)} />
        {style.label}
      </p>
      <p className="mt-1.5 font-display text-4xl font-semibold tracking-tight tabular-nums text-ink-900 sm:text-5xl" aria-live="off">
        {available ? percent(shown) : <span className="text-2xl text-ink-400 sm:text-3xl">No data</span>}
      </p>
      <p className="mt-1 h-4 text-xs tabular-nums text-ink-500">
        {available && delta !== null && Math.round(delta * 100) !== 0 ? `${points(delta)} pts since start` : ""}
      </p>
    </div>
  );
}

/** The three replayed values, each with its label and line style. */
export function ReplayStats({
  state,
  first,
  available,
}: {
  state: ReplayPoint | null;
  first: ReplayPoint | null;
  available: Record<SeriesKey, boolean>;
}) {
  return (
    <div className="grid grid-cols-3 gap-4 sm:gap-8">
      {SERIES.map((series) => (
        <Stat
          key={series}
          series={series}
          value={state?.[series] ?? null}
          start={first?.[series] ?? null}
          available={available[series]}
        />
      ))}
    </div>
  );
}
