"use client";

import { formatShortDate } from "@/lib/market-view/format";
import { compareMoments, SERIES_LABEL, type ReplayPoint, type SeriesKey } from "@/lib/market-view/replay";
import { cn } from "../cn";
import { percent, points, SERIES_STYLE } from "./series";

/**
 * Two moments side by side with the change in each signal and in the gaps
 * between them. Numbers only: no generated explanation.
 */
export function CompareMoments({
  data,
  a,
  b,
  available,
  onSetA,
  onSetB,
}: {
  data: ReplayPoint[];
  a: number;
  b: number;
  available: Record<SeriesKey, boolean>;
  onSetA: () => void;
  onSetB: () => void;
}) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  const result = compareMoments(data, from, to);
  const rows = result.rows.filter((row) => available[row.series]);
  const gap = result.gaps[0];

  return (
    <section aria-labelledby="compare-heading" className="animate-[rise-in_260ms_var(--ease-out-soft)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="compare-heading" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
          Compare moments
        </h3>
        <div className="flex gap-1.5">
          <button type="button" onClick={onSetA} className="whitespace-nowrap rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-semibold text-ink-700 hover:bg-ink-200">
            Set A here
          </button>
          <button type="button" onClick={onSetB} className="whitespace-nowrap rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-semibold text-ink-700 hover:bg-ink-200">
            Set B here
          </button>
        </div>
      </div>

      <table className="mt-3 w-full text-sm tabular-nums">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
            <th scope="col" className="pb-2 text-left font-semibold">
              <span className="sr-only">Signal</span>
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              {a <= b ? "A" : "B"} · {formatShortDate(from)}
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              {a <= b ? "B" : "A"} · {formatShortDate(to)}
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.series} className="border-t border-hairline">
              <th scope="row" className="py-2 text-left font-medium text-ink-700">
                <span className="flex items-center gap-2">
                  <span aria-hidden className={cn("w-4", SERIES_STYLE[row.series].swatch)} />
                  {SERIES_STYLE[row.series].short}
                </span>
              </th>
              <td className="py-2 text-right text-ink-600">{percent(row.from)}</td>
              <td className="py-2 text-right font-semibold text-ink-900">{percent(row.to)}</td>
              <td
                className={cn(
                  "py-2 text-right font-semibold",
                  row.delta !== null && Math.abs(row.delta) >= 0.1 ? "text-red-700" : "text-ink-900",
                )}
              >
                {points(row.delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length > 0 && (
        <dl className="mt-4 space-y-2 border-t border-hairline pt-4">
          {rows
            .filter((row) => row.delta !== null)
            .map((row) => (
              <div key={row.series} className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="text-ink-600">{SERIES_LABEL[row.series]}</dt>
                <dd className="font-semibold tabular-nums text-ink-900">{points(row.delta)} points</dd>
              </div>
            ))}
          {gap && (
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <dt className="text-ink-600">
                {SERIES_STYLE[gap.a].short} vs {SERIES_STYLE[gap.b].short} gap
              </dt>
              <dd className="font-semibold tabular-nums text-ink-900">
                {points(gap.delta)} points{" "}
                <span className="font-normal text-ink-500">
                  ({Math.round(gap.from * 100)} to {Math.round(gap.to * 100)})
                </span>
              </dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
