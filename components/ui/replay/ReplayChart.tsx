"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { timeTicks } from "@/lib/market-view/chart";
import { formatShortDate } from "@/lib/market-view/format";
import { SERIES, stateAt, widestGap, type ReplayData, type SeriesKey } from "@/lib/market-view/replay";
import { usePrefs } from "../a11y/preferences";
import { lineStyle, markerTimes, SeriesMarker, showsMarkers } from "../chart-style";
import { percent, SERIES_STYLE } from "./series";

/** Gaps at or above this many points (as a fraction) are highlighted. */
export const DIVERGENCE_THRESHOLD = 0.12;

const GRID = [0, 0.25, 0.5, 0.75, 1];

/**
 * The three signals drawn up to the playhead only. Future portions never show.
 * Divergence between two signals gets a subtle shaded band and a gap label.
 */
export function ReplayChart({
  data,
  time,
  available,
  compare,
  tall = false,
}: {
  data: ReplayData;
  time: number;
  available: Record<SeriesKey, boolean>;
  compare: { a: number; b: number } | null;
  tall?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const mode = usePrefs().chart;
  const [width, setWidth] = useState(800);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(300, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = width < 520 ? 240 : tall ? 420 : 320;
  // Right padding leaves room for the value tags at the playhead, even at the end.
  const pad = { top: 18, right: width < 520 ? 78 : 96, bottom: 28, left: 40 };
  const span = Math.max(1, data.end - data.start);
  const xFor = (t: number) => pad.left + ((t - data.start) / span) * (width - pad.left - pad.right);
  const yFor = (v: number) => pad.top + (1 - v) * (height - pad.top - pad.bottom);

  const paths = useMemo(() => {
    const result: Partial<Record<SeriesKey, string>> = {};
    for (const series of SERIES) {
      let d = "";
      for (const point of data.points) {
        const value = point[series];
        if (value === null) continue;
        const x = xFor(point.at).toFixed(1);
        const y = yFor(value).toFixed(1);
        d += d ? `H${x}V${y}` : `M${x},${y}`;
      }
      if (d) result[series] = `${d}H${xFor(data.end).toFixed(1)}`;
    }
    return result;
    // Geometry depends on width and height through xFor and yFor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, height]);

  const state = stateAt(data.points, time);
  const playheadX = xFor(time);
  const gap = state ? widestGap(state) : null;
  const diverging = gap && gap.gap >= DIVERGENCE_THRESHOLD ? gap : null;

  // Shaded band between the diverging pair wherever their gap stayed wide.
  const band = useMemo(() => {
    if (!diverging) return [];
    const rects: { x: number; y: number; w: number; h: number }[] = [];
    data.points.forEach((point, index) => {
      if (point.at > time) return;
      const a = point[diverging.a];
      const b = point[diverging.b];
      if (a === null || b === null || Math.abs(a - b) < DIVERGENCE_THRESHOLD) return;
      const next = Math.min(time, data.points[index + 1]?.at ?? data.end);
      rects.push({ x: xFor(point.at), y: yFor(Math.max(a, b)), w: Math.max(0, xFor(next) - xFor(point.at)), h: Math.abs(yFor(a) - yFor(b)) });
    });
    return rects;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diverging?.a, diverging?.b, data, time, width, height]);

  // Value tags at the playhead, nudged apart so they never overlap.
  const tags = SERIES.filter((series) => available[series] && state?.[series] != null)
    .map((series) => ({ series, value: state![series] as number, y: yFor(state![series] as number) }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < tags.length; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + 18);

  // Shape markers along each line (accessible chart modes), only up to the playhead.
  const lineMarkers = showsMarkers(mode)
    ? markerTimes(data.start, time, width < 520 ? 4 : 7).flatMap((at) => {
        const atState = stateAt(data.points, at);
        return SERIES.filter((series) => available[series] && atState?.[series] != null).map((series) => ({
          series,
          x: xFor(at),
          y: yFor(atState![series] as number),
        }));
      })
    : [];

  const visibleEvents = data.events.filter((event) => event.at <= time);
  const ticks = timeTicks(data.start, data.end, width < 520 ? 3 : 5);

  const activityMax = Math.max(1, ...(data.activity ?? []).map((bucket) => bucket.yesCredits + bucket.noCredits));

  return (
    <div ref={containerRef} className="relative w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full select-none" aria-hidden>
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={Math.max(0, playheadX + 1)} height={height} />
          </clipPath>
        </defs>

        {GRID.map((value) => (
          <g key={value}>
            <line x1={pad.left} x2={width - pad.right} y1={yFor(value)} y2={yFor(value)} className="stroke-ink-100" />
            <text x={pad.left - 10} y={yFor(value)} dy="0.32em" textAnchor="end" className="fill-ink-500 text-[11px] tabular-nums">
              {Math.round(value * 100)}%
            </text>
          </g>
        ))}
        {ticks.map((tick, index) => (
          <text
            key={tick}
            x={xFor(tick)}
            y={height - 8}
            textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}
            className="fill-ink-500 text-[11px]"
          >
            {formatShortDate(tick)}
          </text>
        ))}

        {visibleEvents.map((event) => (
          <line
            key={event.id}
            x1={xFor(event.at)}
            x2={xFor(event.at)}
            y1={pad.top}
            y2={height - pad.bottom}
            strokeDasharray="2 4"
            className={`animate-[vt-fade_400ms_ease-out] ${event.origin === "derived" ? "stroke-red-500/40" : "stroke-ink-300"}`}
          />
        ))}

        {band.map((rect, index) => (
          <rect key={index} x={rect.x} y={rect.y} width={rect.w} height={rect.h} className="fill-red-500/[0.07]" />
        ))}

        <g clipPath={`url(#${clipId})`}>
          {SERIES.map((series) => {
            const style = lineStyle(series, mode);
            return paths[series] ? (
              <path
                key={series}
                d={paths[series]}
                fill="none"
                className={style.stroke}
                strokeWidth={style.width}
                strokeDasharray={style.dash}
                strokeLinejoin="round"
                strokeLinecap={style.dash ? style.cap : "round"}
              />
            ) : null;
          })}
          {lineMarkers.map((marker, index) => (
            <SeriesMarker
              key={index}
              shape={lineStyle(marker.series, mode).marker}
              x={marker.x}
              y={marker.y}
              size={3.5}
              className={lineStyle(marker.series, mode).fill}
            />
          ))}
        </g>

        {compare &&
          (["a", "b"] as const).map((key) => (
            <g key={key}>
              <line
                x1={xFor(compare[key])}
                x2={xFor(compare[key])}
                y1={pad.top}
                y2={height - pad.bottom}
                className="stroke-ink-900"
                strokeWidth={1}
              />
              <rect x={xFor(compare[key]) - 9} y={pad.top - 2} width={18} height={16} rx={5} className="fill-ink-900" />
              <text x={xFor(compare[key])} y={pad.top + 10} textAnchor="middle" className="fill-surface text-[10px] font-bold">
                {key.toUpperCase()}
              </text>
            </g>
          ))}

        <line x1={playheadX} x2={playheadX} y1={pad.top} y2={height - pad.bottom} className="stroke-ink-900/40" strokeWidth={1} />

        {diverging && state && (
          <g className="animate-[vt-fade_300ms_ease-out]">
            <line
              x1={playheadX - 7}
              x2={playheadX - 7}
              y1={yFor(state[diverging.a] as number)}
              y2={yFor(state[diverging.b] as number)}
              className="stroke-red-500"
              strokeWidth={1.5}
            />
            <text
              x={playheadX - 13}
              y={(yFor(state[diverging.a] as number) + yFor(state[diverging.b] as number)) / 2}
              dy="0.32em"
              textAnchor="end"
              stroke="var(--color-surface)"
              strokeWidth={4}
              paintOrder="stroke"
              className="fill-red-700 text-[11px] font-semibold tabular-nums"
            >
              {Math.round(diverging.gap * 100)} pt gap
            </text>
          </g>
        )}

        {tags.map((tag) => (
          <g key={tag.series}>
            {showsMarkers(mode) ? (
              <SeriesMarker
                shape={lineStyle(tag.series, mode).marker}
                x={playheadX}
                y={yFor(tag.value)}
                size={4.5}
                className={lineStyle(tag.series, mode).fill}
              />
            ) : (
              <circle cx={playheadX} cy={yFor(tag.value)} r={3.5} className="fill-surface stroke-ink-900" strokeWidth={1.5} />
            )}
            <text
              x={playheadX + 10}
              y={tag.y}
              dy="0.32em"
              textAnchor="start"
              stroke="var(--color-surface)"
              strokeWidth={4}
              paintOrder="stroke"
              className="fill-ink-900 text-[11px] font-semibold tabular-nums"
            >
              {SERIES_STYLE[tag.series].short} {percent(tag.value)}
            </text>
          </g>
        ))}
      </svg>

      {data.activity && data.activity.length > 0 && (
        <svg viewBox={`0 0 ${width} 30`} className="mt-1 h-auto w-full" aria-hidden>
          {data.activity
            .filter((bucket) => bucket.start <= time)
            .map((bucket) => {
              const x = xFor(bucket.start);
              const w = Math.max(2, xFor(bucket.end) - x - 2);
              const yesH = (bucket.yesCredits / activityMax) * 26;
              const noH = (bucket.noCredits / activityMax) * 26;
              return (
                <g key={bucket.start} className="animate-[vt-fade_300ms_ease-out]">
                  <rect x={x} y={30 - yesH - noH} width={w} height={noH} rx={1} className="fill-ink-300" />
                  <rect x={x} y={30 - yesH} width={w} height={yesH} rx={1} className="fill-red-500/70" />
                </g>
              );
            })}
        </svg>
      )}
    </div>
  );
}
