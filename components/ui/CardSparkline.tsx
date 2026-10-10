"use client";

import { useEffect, useRef, useState } from "react";
import { plottable } from "@/lib/market-view/chart";
import type { HistoryPoint } from "@/lib/market-view/types";
import { usePrefs } from "./a11y/preferences";
import { lineStyle, SeriesMarker, showsMarkers } from "./chart-style";
import { cn } from "./cn";

const cache = new Map<string, Promise<HistoryPoint[]>>();

function loadHistory(slug: string): Promise<HistoryPoint[]> {
  let request = cache.get(slug);
  if (!request) {
    request = fetch(`/api/markets/${encodeURIComponent(slug)}/history`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data?: { points?: HistoryPoint[] } } | null) => body?.data?.points ?? [])
      .catch(() => []);
    cache.set(slug, request);
  }
  return request;
}

/** Normalized polyline points for a small sparkline box. */
export function sparklinePoints(history: HistoryPoint[], width: number, height: number): string | null {
  const data = plottable(history).slice(-40);
  if (data.length < 2) return null;
  const times = data.map((point) => Date.parse(point.at));
  const start = times[0];
  const span = Math.max(1, times[times.length - 1] - start);
  return data
    .map((point, index) => `${(((times[index] - start) / span) * width).toFixed(1)},${((1 - point.share) * height).toFixed(1)}`)
    .join(" ");
}

/**
 * Tiny allocation trend that loads the first time the pointer enters the card
 * and fades in on hover. Touch devices never load it.
 */
export function CardSparkline({ slug }: { slug: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [points, setPoints] = useState<string | null>(null);
  const mode = usePrefs().chart;
  const patterned = showsMarkers(mode);
  const style = lineStyle("allocation", mode);
  const end = points?.split(" ").at(-1)?.split(",").map(Number);

  useEffect(() => {
    const card = ref.current?.closest("article");
    if (!card) return;
    let cancelled = false;
    const onEnter = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      card.removeEventListener("pointerenter", onEnter);
      loadHistory(slug).then((history) => !cancelled && setPoints(sparklinePoints(history, 64, 22)));
    };
    card.addEventListener("pointerenter", onEnter);
    return () => {
      cancelled = true;
      card.removeEventListener("pointerenter", onEnter);
    };
  }, [slug]);

  return (
    <span ref={ref} aria-hidden className="pointer-events-none block h-[22px] w-16 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
      {points && (
        <svg viewBox="0 0 64 22" className="h-full w-full overflow-visible">
          {patterned ? (
            <>
              <polyline
                points={points}
                fill="none"
                className={style.stroke}
                strokeWidth={Math.min(style.width, 2.5)}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {end && <SeriesMarker shape={style.marker} x={end[0]} y={end[1]} size={3} className={style.fill} />}
            </>
          ) : (
            <polyline
              points={points}
              fill="none"
              className={cn("animate-[draw_600ms_var(--ease-out-soft)_forwards]", style.stroke)}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
    </span>
  );
}
