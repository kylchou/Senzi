"use client";

import { useId, useRef, useState } from "react";
import { formatDate, formatDateTime, formatIndicatorValue, formatRelativeChange } from "@/lib/vc/format";

export interface IndicatorChartProps {
  label: string;
  unit: string;
  /** False for rank metrics: a lower number is better, so the axis is flipped (up = better). */
  higherIsBetter: boolean;
  sourceName: string;
  sourceUrl: string | null;
  fetchedAt: string | null;
  /** Relative change vs four weeks earlier, from the indicator. */
  change4w: number | null;
  points: { date: string; value: number }[];
}

const W = 320;
const H = 120;
const PAD = { l: 44, r: 12, t: 10, b: 20 };
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const axisText = (v: number, unit: string) => (unit === "rank" ? `#${compact.format(v)}` : compact.format(v));

/**
 * One public metric over time. A single series, so there is no legend: the title names it.
 * Line is 2px in the ink color; hovering (or arrow keys on focus) snaps a crosshair and
 * tooltip to the nearest point; "View data" lists every value.
 */
export function IndicatorChart({ label, unit, higherIsBetter, sourceName, sourceUrl, fetchedAt, change4w, points }: IndicatorChartProps) {
  const id = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [active, setActive] = useState<number | null>(null);

  const values = points.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(Math.abs(hi), 1) * 0.1;
  const yMin = lo - span * 0.1;
  const yMax = hi + span * 0.1;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length > 1 ? (innerW * i) / (points.length - 1) : innerW / 2);
  // Flip rank metrics so an improving (lower) rank rises on the chart.
  const y = (v: number) => {
    const t = (v - yMin) / (yMax - yMin);
    return PAD.t + innerH * (higherIsBetter ? 1 - t : t);
  };
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points.length - 1;
  const shown = active ?? last;

  const nearest = (clientX: number) => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? last) - 1));
    else if (e.key === "ArrowRight") setActive((a) => Math.min(last, (a ?? last) + 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  const tipLeft = Math.min(Math.max((x(shown) / W) * 100, 14), 86);
  const tickValues = [hi, lo].filter((v, i, a) => a.indexOf(v) === i);

  return (
    <li className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <h3 id={id} className="text-sm font-medium">
        {label}
      </h3>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="text-lg font-semibold tabular-nums">{formatIndicatorValue(values[last], unit)}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {formatRelativeChange(change4w)} vs 4 weeks earlier
          {!higherIsBetter && " · lower rank is better"}
        </span>
      </p>

      <div className="relative mt-2">
        {points.length < 2 ? (
          <p className="py-6 text-xs text-slate-500">Only one observation so far, so there is no trend to chart yet.</p>
        ) : (
          <>
            <p id={`${id}-desc`} className="sr-only">
              {`${label} over time, ${points.length} points from ${formatDate(points[0].date)} to ${formatDate(points[last].date)}. Use the arrow keys to read values.`}
            </p>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              tabIndex={0}
              aria-labelledby={id}
              aria-describedby={`${id}-desc`}
              className="w-full touch-none text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 dark:text-slate-100"
              onPointerMove={(e) => nearest(e.clientX)}
              onPointerDown={(e) => nearest(e.clientX)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive((a) => a ?? last)}
              onBlur={() => setActive(null)}
              onKeyDown={onKey}
            >
              {tickValues.map((v) => (
                <g key={v}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
                  <text x={PAD.l - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.6">
                    {axisText(v, unit)}
                  </text>
                </g>
              ))}
              <text x={PAD.l} y={H - 5} fontSize="10" fill="currentColor" fillOpacity="0.6">
                {formatDate(points[0].date)}
              </text>
              <text x={W - PAD.r} y={H - 5} textAnchor="end" fontSize="10" fill="currentColor" fillOpacity="0.6">
                {formatDate(points[last].date)}
              </text>

              {active !== null && <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={PAD.t + innerH} stroke="currentColor" strokeOpacity="0.25" strokeWidth="1" />}
              <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {/* Surface ring (2px) keeps the dot legible where it meets the line. */}
              <circle cx={x(shown)} cy={y(points[shown].value)} r="4" fill="currentColor" className="stroke-white dark:stroke-slate-950" strokeWidth="2" />
            </svg>
            {active !== null && (
              <div
                role="status"
                className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900"
                style={{ left: `${tipLeft}%` }}
              >
                <div className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-0.5 w-3 rounded bg-slate-900 dark:bg-slate-100" />
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">{formatIndicatorValue(points[active].value, unit)}</span>
                </div>
                <div className="text-slate-500 dark:text-slate-400">{formatDate(points[active].date)}</div>
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        {sourceUrl ? (
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-600">
            {sourceName}
          </a>
        ) : (
          sourceName
        )}{" "}
        · fetched {formatDateTime(fetchedAt)}
      </p>

      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-slate-600 dark:text-slate-300">View data</summary>
        <div className="mt-1 max-h-48 overflow-auto">
          <table className="w-full text-left">
            <thead className="text-slate-500">
              <tr>
                <th className="py-0.5 pr-2 font-medium">Period ending</th>
                <th className="py-0.5 text-right font-medium">{label}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.date} className="border-t border-slate-100 dark:border-slate-900">
                  <td className="py-0.5 pr-2">{formatDate(p.date)}</td>
                  <td className="py-0.5 text-right tabular-nums">{formatIndicatorValue(p.value, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </li>
  );
}
