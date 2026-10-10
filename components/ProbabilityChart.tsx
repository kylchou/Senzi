"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  areaPath,
  availableRanges,
  buildGeometry,
  CHART_RANGES,
  nearestIndex,
  plottable,
  sliceHistory,
  timeTicks,
  type ChartBox,
  type ChartRangeKey,
} from "@/lib/market-view/chart";
import { formatDate, formatDateTime, formatPointChange, formatShare } from "@/lib/market-view/format";
import { eventImpact } from "@/lib/market-view/insights";
import type { HistoryPoint, NewsItemView } from "@/lib/market-view/types";
import { usePrefs } from "@/components/ui/a11y/preferences";
import { LineSwatch, lineStyle, SeriesMarker, showsMarkers, type LineStyle } from "@/components/ui/chart-style";
import { cn } from "@/components/ui/cn";
import { Term } from "@/components/ui/Term";

/**
 * Line drawing props. The default mode draws the line in once; accessible chart
 * modes use the line pattern instead (the draw trick needs the dash array).
 */
function lineProps(style: LineStyle, patterned: boolean) {
  const base = { fill: "none", strokeWidth: style.width, strokeLinejoin: "round" as const };
  if (patterned) {
    return { ...base, className: style.stroke, strokeDasharray: style.dash, strokeLinecap: style.dash ? style.cap : ("round" as const) };
  }
  return {
    ...base,
    className: cn("animate-[draw_900ms_var(--ease-out-soft)_forwards]", style.stroke),
    strokeLinecap: "round" as const,
    pathLength: 1,
    strokeDasharray: 1,
    strokeDashoffset: 1,
  };
}

/** Chart box in real pixels so labels stay readable at every width. */
function boxFor(width: number): ChartBox {
  return { width, height: width < 480 ? 220 : 280, padding: { top: 16, right: 12, bottom: 32, left: 46 } };
}

/**
 * Market probability (the price of a YES share) over time, with the calibrated probability
 * (when the engine provides one) and the opening baseline drawn as separate,
 * labeled lines. Drawn like a stock chart: straight moves between trades and an
 * axis zoomed to where the values are, with the current value and change on top.
 */
export function ProbabilityChart({
  history,
  openingBaseline,
  now,
  live = false,
  events = [],
}: {
  history: HistoryPoint[];
  openingBaseline: number | null;
  /** News linked to the market, drawn as markers so readers can see why the line moved. */
  events?: NewsItemView[];
  /** End of the time axis, fixed on the server so server and client draw the same chart. */
  now: number;
  /** Pulse the latest point while the market is open. */
  live?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const titleId = useId();
  const gradientId = useId();
  const [width, setWidth] = useState(720);
  const [range, setRange] = useState<ChartRangeKey>("all");
  const [active, setActive] = useState<number | null>(null);
  const mode = usePrefs().chart;
  const patterned = showsMarkers(mode);
  const allocationStyle = lineStyle("allocation", mode);
  const calibratedStyle = lineStyle("calibrated", mode);
  const baselineStyle = lineStyle("baseline", mode);

  const ranges = useMemo(() => availableRanges(history, now), [history, now]);
  const days = CHART_RANGES.find((option) => option.key === range)?.days ?? null;
  const shown = useMemo(() => sliceHistory(history, days, now), [history, days, now]);
  const box = useMemo(() => boxFor(width), [width]);
  const geometry = useMemo(() => buildGeometry(shown, box, now, openingBaseline), [shown, box, now, openingBaseline]);
  const hasChart = plottable(history).length >= 2 && geometry !== null;

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
        <ChartIllustration />
        <p className="mt-2 font-display font-semibold text-ink-900">Not enough history yet</p>
        <p className="text-sm text-ink-600">The chart appears after more forecasts are recorded.</p>
      </div>
    );
  }

  const { points, path, calibratedPath, domain, start, end, xFor, yFor } = geometry;
  const bottom = box.height - box.padding.bottom;
  const markers = events
    .map((event) => ({ event, time: Date.parse(event.publishedAt) }))
    .filter(({ time }) => time >= start && time <= end)
    .map(({ event, time }) => ({ event, x: xFor(time), impact: eventImpact(history, event.publishedAt, now) }));
  const current = active !== null ? points[active] : null;
  const last = points[points.length - 1];
  // Stock-style readout: the value under the cursor (or the latest) and its change over the range.
  const shownValue = (current ?? last).point.share;
  const change = shownValue - points[0].point.share;
  const changePoints = Math.round(change * 100);
  const since = CHART_RANGES.find((option) => option.key === range)?.since ?? "since open";
  // Shape markers along each line in accessible chart modes.
  const markerEvery = Math.max(1, Math.ceil(points.length / 8));
  const lineMarkers = patterned
    ? points.filter((_, index) => index % markerEvery === 0 && index < points.length - 1)
    : [];

  function pointAt(clientX: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setActive(nearestIndex(points, ((clientX - rect.left) / rect.width) * box.width));
  }

  function onKeyDown(event: React.KeyboardEvent<SVGSVGElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" ? -1 : 1;
    setActive((index) => Math.min(points.length - 1, Math.max(0, (index ?? points.length - 1) + step)));
  }

  function chooseRange(key: ChartRangeKey) {
    setRange(key);
    setActive(null);
  }

  return (
    <figure>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-3xl font-bold tabular-nums text-ink-900">{formatShare(shownValue)}</p>
          <p className="mt-0.5 text-sm tabular-nums">
            <span
              className={cn(
                "font-semibold",
                changePoints > 0 ? "text-emerald-700 dark:text-emerald-300" : changePoints < 0 ? "text-red-700" : "text-ink-500",
              )}
            >
              {changePoints > 0 ? "▲" : changePoints < 0 ? "▼" : "■"} {Math.abs(changePoints)} {Math.abs(changePoints) === 1 ? "pt" : "pts"}
            </span>{" "}
            <span className="text-ink-500">{current ? formatDateTime(current.point.at) : since}</span>
          </p>
        </div>
      {ranges.length > 0 && (
        <div role="radiogroup" aria-label="Time range" className="flex justify-end">
          <div className="inline-flex rounded-full bg-ink-100 p-0.5">
            {ranges.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={range === key}
                onClick={() => chooseRange(key)}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-semibold text-ink-600 transition-colors hover:text-ink-900 sm:h-7",
                  range === key && "bg-surface text-ink-900 shadow-[var(--shadow-card)]",
                )}
              >
                {CHART_RANGES.find((option) => option.key === key)?.label}
              </button>
            ))}
          </div>
        </div>
      )}
      </div>

      <div ref={containerRef} className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${box.width} ${box.height}`}
          className="h-auto w-full touch-pan-y select-none rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerDown={(event) => pointAt(event.clientX)}
          onPointerMove={(event) => pointAt(event.clientX)}
          // Touch keeps the tooltip after lifting the finger; a mouse clears it on leave.
          onPointerLeave={(event) => event.pointerType === "mouse" && setActive(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(null)}
        >
          <title id={titleId}>
            {`Market probability from ${formatShare(points[0].point.share)} to ${formatShare(last.point.share)}` +
              (openingBaseline !== null ? `. Opening baseline ${formatShare(openingBaseline)}.` : ".")}
          </title>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-red-500)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-red-500)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {domain.ticks.map((value) => (
            <g key={value}>
              <line
                x1={box.padding.left}
                x2={box.width - box.padding.right}
                y1={yFor(value)}
                y2={yFor(value)}
                className="stroke-ink-100"
                strokeWidth={1}
              />
              <text
                x={box.padding.left - 10}
                y={yFor(value)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-500 text-[11px] tabular-nums"
              >
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

          {markers.map(({ event, x }) => (
            <line
              key={event.id}
              x1={x}
              x2={x}
              y1={box.padding.top}
              y2={bottom}
              className="stroke-ink-300"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
          ))}

          {/* Keyed by range so switching ranges redraws the lines. */}
          <g key={range}>
            <path
              d={areaPath(path, bottom, points[0].x)}
              fill={`url(#${gradientId})`}
              className="animate-[vt-fade_700ms_ease-out_both]"
            />

            {openingBaseline !== null && (
              <g>
                <line
                  x1={box.padding.left}
                  x2={box.width - box.padding.right}
                  y1={yFor(openingBaseline)}
                  y2={yFor(openingBaseline)}
                  className={baselineStyle.stroke}
                  strokeWidth={baselineStyle.width}
                  strokeDasharray={baselineStyle.dash}
                  strokeLinecap={baselineStyle.cap}
                />
                <text
                  x={box.width - box.padding.right}
                  y={yFor(openingBaseline)}
                  dy={yFor(openingBaseline) - box.padding.top < 18 ? "1.3em" : "-0.6em"}
                  textAnchor="end"
                  className="fill-ink-600 text-[11px] font-medium"
                >
                  Baseline {formatShare(openingBaseline)}
                </text>
              </g>
            )}

            {calibratedPath && <path d={calibratedPath} {...lineProps(calibratedStyle, patterned)} />}

            <path d={path} {...lineProps(allocationStyle, patterned)} />

            {lineMarkers.map(({ x, y, point }) => (
              <g key={point.at}>
                <SeriesMarker shape={allocationStyle.marker} x={x} y={y} size={3.5} className={allocationStyle.fill} />
                {point.calibrated !== null && calibratedPath && (
                  <SeriesMarker
                    shape={calibratedStyle.marker}
                    x={x}
                    y={yFor(point.calibrated)}
                    size={3.5}
                    className={calibratedStyle.fill}
                  />
                )}
              </g>
            ))}
          </g>

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
              <circle cx={current.x} cy={current.y} r={5} className="fill-red-500 stroke-surface" strokeWidth={2} />
            </g>
          ) : (
            <g>
              {live && (
                <circle
                  cx={last.x}
                  cy={last.y}
                  r={4.5}
                  aria-hidden
                  className="animate-[live-ping_2.4s_ease-out_infinite] fill-red-500 [transform-box:fill-box] [transform-origin:center]"
                />
              )}
              {patterned ? (
                <SeriesMarker shape={allocationStyle.marker} x={last.x} y={last.y} size={5} className={allocationStyle.fill} />
              ) : (
                <circle cx={last.x} cy={last.y} r={4.5} className="fill-red-500 stroke-surface" strokeWidth={2} />
              )}
            </g>
          )}
        </svg>

        {current && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 -translate-x-1/2 rounded-lg bg-ink-900 px-3 py-2 text-xs text-surface shadow-[var(--shadow-lift)] transition-[left] duration-100"
            style={{ left: `${Math.min(85, Math.max(15, (current.x / box.width) * 100))}%` }}
          >
            <p className="text-ink-300">{formatDateTime(current.point.at)}</p>
            <p className="mt-0.5 font-semibold tabular-nums">{formatShare(current.point.share)} market probability</p>
            {current.point.calibrated !== null && (
              <p className="tabular-nums">{formatShare(current.point.calibrated)} calibrated</p>
            )}
            <p className="tabular-nums text-ink-300">{current.point.forecasterCount} forecasters</p>
          </div>
        )}

        {markers.map(({ event, x, impact }) => {
          const left = (x / box.width) * 100;
          const align = left < 25 ? "left-0" : left > 75 ? "right-0" : "left-1/2 -translate-x-1/2";
          return (
            <a
              key={event.id}
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`News, ${formatDate(event.publishedAt)}: ${event.title}, ${event.publisher}`}
              data-hit-exempt="marker"
              className="group absolute z-20 -translate-x-1/2 -translate-y-1/2 p-1.5"
              style={{ left: `${left}%`, top: `${(bottom / box.height) * 100}%` }}
            >
              <span className="block size-3 rounded-full border-2 border-red-500 bg-surface transition-transform duration-200 group-hover:scale-125 group-focus-visible:scale-125" />
              <span
                role="tooltip"
                className={`pointer-events-none absolute hidden animate-[vt-fade_150ms_ease-out] bottom-full mb-1 w-64 rounded-xl bg-ink-900 p-3 text-left text-xs text-surface shadow-[var(--shadow-lift)] group-hover:block group-focus-visible:block ${align}`}
              >
                <span className="block text-ink-300">
                  {event.publisher} · {formatDate(event.publishedAt)}
                </span>
                <span className="mt-1 block font-semibold leading-snug">{event.title}</span>
                {impact && (
                  <span className="mt-2 block tabular-nums text-ink-300">
                    Market probability {formatShare(impact.before)} to {formatShare(impact.after)} over the next 3 days (
                    {formatPointChange(impact.delta)})
                  </span>
                )}
              </span>
            </a>
          );
        })}
      </div>

      <figcaption className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-600">
        <span className="inline-flex items-center gap-2">
          <LineSwatch style={allocationStyle} mode={mode} />
          Market probability
        </span>
        {calibratedPath && (
          <span className="inline-flex items-center gap-2">
            <LineSwatch style={calibratedStyle} mode={mode} />
            <span>
              Calibrated <Term id="probability">probability</Term>
            </span>
          </span>
        )}
        {openingBaseline !== null && (
          <span className="inline-flex items-center gap-2">
            <LineSwatch style={baselineStyle} mode={mode} />
            Opening baseline
          </span>
        )}
        {markers.length > 0 && (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-full border-2 border-red-500 bg-surface" />
            News
          </span>
        )}
      </figcaption>

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-ink-600 hover:text-ink-900">
          View data table
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-ink-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-ink-50 text-ink-600">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Recorded
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Market probability
                </th>
                {calibratedPath && (
                  <th scope="col" className="px-3 py-2 text-right font-medium">
                    Calibrated
                  </th>
                )}
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Forecasters
                </th>
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

/** Small line-chart drawing for the empty state. */
function ChartIllustration() {
  return (
    <svg viewBox="0 0 120 48" className="h-12 w-28" aria-hidden>
      <path d="M4 40H116" className="stroke-ink-300" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M8 34L30 26L52 30L74 16L96 20L112 20"
        fill="none"
        className="stroke-ink-400"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="4 5"
      />
      <circle cx="112" cy="20" r="4" className="fill-red-500" />
    </svg>
  );
}
