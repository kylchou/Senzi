"use client";

import { useRef } from "react";
import { formatLongDate, formatShortDate } from "@/lib/market-view/format";
import type { ReplayEvent } from "@/lib/market-view/replay";
import { cn } from "../cn";

/**
 * Lanes for event markers so events close in time never cover each other.
 * Each marker goes in the first lane whose last marker is at least `minGap`
 * percent to the left.
 */
export function markerLanes(positions: number[], minGap = 3, maxLanes = 3): number[] {
  const laneEnds: number[] = [];
  return positions.map((position) => {
    let lane = laneEnds.findIndex((end) => position - end >= minGap);
    if (lane === -1) lane = laneEnds.length < maxLanes ? laneEnds.length : laneEnds.indexOf(Math.min(...laneEnds));
    laneEnds[lane] = position;
    return lane;
  });
}

/** Small clickable marker above the track. Past events are solid; upcoming ones are faint. */
export function ReplayEventMarker({
  event,
  left,
  lane,
  past,
  selected,
  onSelect,
}: {
  event: ReplayEvent;
  left: number;
  lane: number;
  past: boolean;
  selected: boolean;
  onSelect: (event: ReplayEvent) => void;
}) {
  const align = left < 15 ? "left-0" : left > 85 ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      aria-label={`${formatShortDate(event.at)}: ${event.title}`}
      className="group absolute -translate-x-1/2 p-1.5 hover:z-10 focus-visible:z-10"
      style={{ left: `${left}%`, bottom: lane * 16 }}
    >
      <span
        className={cn(
          "block size-2.5 rounded-full transition-[transform,opacity] duration-300 group-hover:scale-150 group-focus-visible:scale-150",
          event.kind === "resolved"
            ? "bg-red-500"
            : event.origin === "derived"
              ? "border-2 border-red-500 bg-surface"
              : event.origin === "demo"
                ? "border-2 border-dashed border-ink-500 bg-surface"
                : "bg-ink-900",
          !past && "opacity-35",
          selected && "scale-150 ring-4 ring-red-500/20",
        )}
      />
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute hidden animate-[vt-fade_150ms_ease-out] bottom-full z-30 mb-1 w-max max-w-56 rounded-lg bg-ink-900 px-2.5 py-1.5 text-left text-[11px] text-surface shadow-[var(--shadow-lift)] group-hover:block group-focus-visible:block",
          align,
        )}
      >
        <span className="block font-semibold uppercase tracking-wide text-ink-300">{formatShortDate(event.at)}</span>
        <span className="block">{event.title}</span>
      </span>
    </button>
  );
}

/** Scrubber: drag, tap, or use the keyboard. Every change moves the whole replay. */
export function ReplayTimeline({
  start,
  end,
  time,
  events,
  selectedEventId,
  compare,
  endLabel,
  onScrub,
  onStep,
  onSelectEvent,
}: {
  start: number;
  end: number;
  time: number;
  events: ReplayEvent[];
  selectedEventId: string | null;
  compare: { a: number; b: number } | null;
  endLabel: string;
  onScrub: (time: number) => void;
  onStep: (direction: -1 | 1) => void;
  onSelectEvent: (event: ReplayEvent) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const span = Math.max(1, end - start);
  const pct = (t: number) => ((Math.min(end, Math.max(start, t)) - start) / span) * 100;
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const lanes = markerLanes(sorted.map((event) => pct(event.at)));
  const laneCount = Math.max(1, ...lanes.map((lane) => lane + 1));

  function timeFromPointer(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return time;
    return start + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * span;
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    onScrub(timeFromPointer(event.clientX));
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) onScrub(timeFromPointer(event.clientX));
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const actions: Record<string, () => void> = {
      ArrowLeft: () => onStep(-1),
      ArrowDown: () => onStep(-1),
      ArrowRight: () => onStep(1),
      ArrowUp: () => onStep(1),
      Home: () => onScrub(start),
      End: () => onScrub(end),
      PageDown: () => onScrub(time - span / 10),
      PageUp: () => onScrub(time + span / 10),
    };
    const action = actions[event.key];
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  return (
    <div>
      <div className="relative" style={{ height: 12 + laneCount * 16 }}>
        {sorted.map((event, index) => (
          <ReplayEventMarker
            key={event.id}
            event={event}
            left={pct(event.at)}
            lane={lanes[index]}
            past={event.at <= time}
            selected={event.id === selectedEventId}
            onSelect={onSelectEvent}
          />
        ))}
      </div>

      <div
        ref={trackRef}
        className="relative flex h-10 cursor-pointer touch-none items-center"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-200">
          <div className="h-full rounded-full bg-ink-900" style={{ width: `${pct(time)}%` }} />
        </div>
        {compare &&
          (["a", "b"] as const).map((key) => (
            <span
              key={key}
              aria-hidden
              className="pointer-events-none absolute top-[calc(50%+10px)] -translate-x-1/2 rounded bg-ink-900 px-1 text-[9px] font-bold leading-4 text-surface"
              style={{ left: `${pct(compare[key])}%` }}
            >
              {key.toUpperCase()}
            </span>
          ))}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Replay position"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatLongDate(time)}
          onKeyDown={onKeyDown}
          className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-900 bg-surface shadow-[0_2px_8px_rgb(0_0_0/0.18)] transition-transform duration-150 hover:scale-110 active:scale-110"
          style={{ left: `${pct(time)}%` }}
        />
      </div>

      <div className="mt-1 flex justify-between text-[11px] font-medium text-ink-500">
        <span>{formatShortDate(start)}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
