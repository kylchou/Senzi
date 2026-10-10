"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildGeometry, nearestIndex, timeTicks, type ChartBox } from "@/lib/market-view/chart";
import { formatDate, formatDateTime, formatShare } from "@/lib/market-view/format";
import type { HistoryPoint } from "@/lib/market-view/types";

/** Chart box in real pixels so labels stay readable at every width. */
function boxFor(width: number): ChartBox {
  return { width, height: width < 480 ? 220 : 280, padding: { top: 16, right: 12, bottom: 32, left: 40 } };
}
const GRID = [0, 0.25, 0.5, 0.75, 1];

/**
 * Community YES allocation share over time, with the calibrated probability
 * (when the engine provides one) and the opening baseline drawn as separate,
 * labeled lines. All three share one 0 to 100% axis.
 */
export function ProbabilityChart({
  history,
  openingBaseline,
  now,
}: {
  history: HistoryPoint[];
  openingBaseline: number | null;
  /** End of the time axis, fixed on the server so server and client draw the same chart. */
  now: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const box = useMemo(() => boxFor(width), [width]);
  const geometry = useMemo(() => buildGeometry(history, box, now), [history, box, now]);
  const [active, setActive] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const hasChart = geometry !== null && geometry.points.length >= 2;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasChart]);

  if (!hasChart || !geometry) {
    return (
      <div className="flex h-56 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-ink-300 bg-ink-50 text-center">
        <p className="font-display font-semibold text-ink-900">Not enough history yet</p>
        <p className="text-sm text-ink-600">The chart appears after more forecasts are recorded.</p>
      </div>
    );
  }

  const { points, path, calibratedPath, start, end, xFor, yFor } = geometry;
  const current = active !== null ? points[active] : null;
  const last = points[points.length - 1];

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((event.clientX - rect.left) / rect.width) * box.width;
    setActive(nearestIndex(points, x));
  }

  function onKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((index) => Math.min(points.length - 1, Math.max(0, (index ?? points.length - 1) + step)));
  }

  return (
    <figure>
      <div ref={containerRef} className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${box.width} ${box.height}`}
          className="h-auto w-full touch-pan-y select-none outline-none"
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          <title id={titleId}>
            {`YES allocation share from ${formatShare(points[0].point.share)} to ${formatShare(last.point.share)}` +
              (openingBaseline !== null ? `. Opening baseline ${formatShare(openingBaseline)}.` : ".")}
          </title>

          {GRID.map((value) => (
            <g key={value}>
              <line
                x1={box.padding.left}
                x2={box.width - box.padding.right}
                y1={yFor(value)}
                y2={yFor(value)}
                className="stroke-ink-100"
                strokeWidth={1}
              />
              <text x={box.padding.left - 10} y={yFor(value)} dy="0.32em" textAnchor="end" className="fill-ink-500 text-[11px] tabular-nums">
                {Math.round(value * 100)}%
              </text>
            </g>
          ))}

          {timeTicks(start, end, box.width < 480 ? 3 : 4).map((time, index, all) => (
            <text
              key={time}
              x={xFor(time)}
              y={box.height - 8}
              textAnchor={index === 0 ? "start" : index === all.length - 1 ? "end" : "middle"}
              className="fill-ink-500 text-[11px]"
            >
              {formatDate(new Date(time).toISOString())}
            </text>
          ))}

          {openingBaseline !== null && (
            <g>
              <line
                x1={box.padding.left}
                x2={box.width - box.padding.right}
                y1={yFor(openingBaseline)}
                y2={yFor(openingBaseline)}
                className="stroke-ink-500"
                strokeWidth={1.5}
                strokeDasharray="5 5"
              />
              <text
                x={box.width - box.padding.right}
                y={yFor(openingBaseline)}
                dy={openingBaseline > 0.85 ? "1.3em" : "-0.6em"}
                textAnchor="end"
                className="fill-ink-600 text-[11px] font-medium"
              >
                Baseline {formatShare(openingBaseline)}
              </text>
            </g>
          )}

          {calibratedPath && (
            <path d={calibratedPath} fill="none" className="stroke-ink-900" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          )}

          <path d={path} fill="none" className="stroke-red-500" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {current ? (
            <g>
              <line
                x1={current.x}
                x2={current.x}
                y1={box.padding.top}
                y2={box.height - box.padding.bottom}
                className="stroke-ink-300"
                strokeWidth={1}
              />
              <circle cx={current.x} cy={current.y} r={5} className="fill-red-500 stroke-white" strokeWidth={2} />
            </g>
          ) : (
            <circle cx={last.x} cy={last.y} r={4.5} className="fill-red-500 stroke-white" strokeWidth={2} />
          )}
        </svg>

        {current && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 -translate-x-1/2 rounded-lg bg-ink-900 px-3 py-2 text-xs text-white shadow-[var(--shadow-lift)]"
            style={{ left: `${Math.min(85, Math.max(15, (current.x / box.width) * 100))}%` }}
          >
            <p className="text-ink-300">{formatDateTime(current.point.at)}</p>
            <p className="mt-0.5 font-semibold tabular-nums">{formatShare(current.point.share)} YES allocation</p>
            {current.point.calibrated !== null && (
              <p className="tabular-nums">{formatShare(current.point.calibrated)} calibrated</p>
            )}
            <p className="tabular-nums text-ink-300">{current.point.forecasterCount} forecasters</p>
          </div>
        )}
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-600">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded-full bg-red-500" />
          YES allocation share
        </span>
        {calibratedPath && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="h-[1.5px] w-5 rounded-full bg-ink-900" />
            Calibrated probability
          </span>
        )}
        {openingBaseline !== null && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="w-5 border-t-[1.5px] border-dashed border-ink-500" />
            Opening baseline
          </span>
        )}
      </figcaption>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-ink-600 hover:text-ink-900">View data table</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-ink-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-50 text-ink-600">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Recorded</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">YES allocation</th>
                {calibratedPath && <th scope="col" className="px-3 py-2 text-right font-medium">Calibrated</th>}
                <th scope="col" className="px-3 py-2 text-right font-medium">Forecasters</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100 tabular-nums">
              {[...points].reverse().map(({ point }) => (
                <tr key={point.at}>
                  <td className="px-3 py-1.5">{formatDateTime(point.at)}</td>
                  <td className="px-3 py-1.5 text-right">{formatShare(point.share)}</td>
                  {calibratedPath && <td className="px-3 py-1.5 text-right">{formatShare(point.calibrated)}</td>}
                  <td className="px-3 py-1.5 text-right">{point.forecasterCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
