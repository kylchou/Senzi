"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ALLOCATION_SHARE_LABEL } from "@/lib/vc/constants";
import { formatDate, formatDateTime } from "@/lib/vc/format";

export interface TrendPoint {
  at: Date | string;
  yesShare: number | null;
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 28, left: 40 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;
const Y_TICKS = [0, 0.25, 0.5, 0.75, 1];

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Historical general LMSR price, with the opening baseline
 * drawn as a separate dashed reference line. Includes a crosshair tooltip and
 * an accessible table view.
 */
export function TrendChart({ points, baseline }: { points: TrendPoint[]; baseline: number | null }) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const data = useMemo(
    () =>
      points
        .map((p) => ({ t: new Date(p.at).getTime(), v: p.yesShare }))
        .sort((a, b) => a.t - b.t),
    [points],
  );
  const defined = data.filter((d) => d.v != null);

  if (defined.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        No forecast history yet. The chart appears after the first community forecasts.
      </p>
    );
  }

  const t0 = data[0].t;
  const t1 = data[data.length - 1].t;
  const span = Math.max(t1 - t0, 1);
  const x = (t: number) => PAD.left + ((t - t0) / span) * plotW;
  const y = (v: number) => PAD.top + (1 - v) * plotH;

  // Break the line where the share is undefined (e.g. all credits withdrawn).
  let path = "";
  let penDown = false;
  for (const d of data) {
    if (d.v == null) {
      penDown = false;
      continue;
    }
    path += `${penDown ? "L" : "M"}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`;
    penDown = true;
  }

  const xTicks = [t0, t0 + span / 2, t1];
  const hovered = hover != null ? data[hover] : null;
  const last = defined[defined.length - 1];

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const t = t0 + ((px - PAD.left) / plotW) * span;
    let best = 0;
    for (let i = 1; i < data.length; i++) {
      if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i;
    }
    setHover(best);
  }

  return (
    <figure className="text-slate-500 dark:text-slate-400">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <figcaption id={titleId} className="font-medium text-slate-700 dark:text-slate-200">
          {ALLOCATION_SHARE_LABEL} over time
        </figcaption>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <svg width="16" height="4" aria-hidden>
              <line x1="0" y1="2" x2="16" y2="2" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" strokeWidth="2" />
            </svg>
            Allocation share
          </span>
          {baseline != null && (
            <span className="flex items-center gap-1.5">
              <svg width="16" height="4" aria-hidden>
                <line x1="0" y1="2" x2="16" y2="2" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
              </svg>
              Opening baseline
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowTable((s) => !s)}
            className="rounded px-1.5 py-0.5 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
            aria-expanded={showTable}
          >
            {showTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>

      {showTable ? (
        <div className="max-h-64 overflow-auto rounded border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
              <tr>
                <th className="px-2 py-1 font-medium">Time</th>
                <th className="px-2 py-1 text-right font-medium">{ALLOCATION_SHARE_LABEL}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1">{formatDateTime(new Date(d.t))}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-slate-900 dark:text-slate-100">
                    {d.v == null ? "—" : `${(d.v * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-none select-none"
            role="img"
            aria-labelledby={titleId}
            aria-describedby={`${titleId}-summary`}
            onPointerMove={onPointerMove}
            onPointerLeave={() => setHover(null)}
          >
            {Y_TICKS.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(v)}
                  y2={y(v)}
                  className="stroke-slate-200 dark:stroke-slate-800"
                  strokeWidth="1"
                />
                <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize="10" fill="currentColor">
                  {pct(v)}
                </text>
              </g>
            ))}
            {xTicks.map((t, i) => (
              <text
                key={i}
                x={x(t)}
                y={H - 8}
                textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
                fontSize="10"
                fill="currentColor"
              >
                {formatDate(new Date(t))}
              </text>
            ))}
            {baseline != null && (
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(baseline)}
                y2={y(baseline)}
                stroke="currentColor"
                strokeWidth="1.5"
                strokeDasharray="4 4"
              />
            )}
            <path
              d={path}
              fill="none"
              className="stroke-[#2a78d6] dark:stroke-[#3987e5]"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hovered && (
              <g>
                <line
                  x1={x(hovered.t)}
                  x2={x(hovered.t)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.5"
                />
                {hovered.v != null && (
                  <circle
                    cx={x(hovered.t)}
                    cy={y(hovered.v)}
                    r="4"
                    className="fill-[#2a78d6] stroke-white dark:fill-[#3987e5] dark:stroke-slate-950"
                    strokeWidth="2"
                  />
                )}
              </g>
            )}
          </svg>
          {hovered && (
            <div
              className="pointer-events-none absolute top-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-900"
              style={{
                left: `${(x(hovered.t) / W) * 100}%`,
                transform: x(hovered.t) > W / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
              }}
            >
              <div className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">
                {hovered.v == null ? "No allocation" : `${(hovered.v * 100).toFixed(1)}%`}
              </div>
              <div>{ALLOCATION_SHARE_LABEL}</div>
              {baseline != null && <div>Baseline {pct(baseline)}</div>}
              <div>{formatDateTime(new Date(hovered.t))}</div>
            </div>
          )}
          <p id={`${titleId}-summary`} className="sr-only">
            Latest {ALLOCATION_SHARE_LABEL.toLowerCase()} {last.v != null ? `${(last.v * 100).toFixed(1)}%` : "unavailable"} on{" "}
            {formatDate(new Date(last.t))}. Use the table view for all values.
          </p>
        </div>
      )}
    </figure>
  );
}
