"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../a11y/useFocusTrap";
import { Maximize2, Minimize2, X } from "lucide-react";
import { formatLongDate, requestTime } from "@/lib/market-view/format";
import {
  availability,
  biggestDivergence,
  biggestMove,
  canReplay,
  stateAt,
  stepTarget,
  type ReplayData,
  type ReplayEvent,
} from "@/lib/market-view/replay";
import { Button } from "../Button";
import { cn } from "../cn";
import { Skeleton } from "../Skeleton";
import { CompareMoments } from "./CompareMoments";
import { ReplayChart } from "./ReplayChart";
import { ReplayControls } from "./ReplayControls";
import { ReplayActivity, ReplayEmptyState, ReplayEventList, ReplayEventPanel, ResolvedCard } from "./ReplayPanels";
import { ReplayStats } from "./ReplayStats";
import { ReplayTimeline } from "./ReplayTimeline";
import { useReplayClock } from "./useReplayClock";

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; data: ReplayData };

/**
 * Focused replay of how a market's three signals evolved. Opens over the market
 * page (which stays visible but dimmed); "Expand" turns it into a full-screen
 * presentation view.
 */
export function MarketReplay({
  slug,
  startupName,
  question,
  onClose,
}: {
  slug: string;
  startupName: string;
  question: string;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/markets/${encodeURIComponent(slug)}/replay`, { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((body: { data: ReplayData }) => setLoad({ state: "ready", data: body.data }))
      .catch((error: Error) => error.name !== "AbortError" && setLoad({ state: "error" }));
    return () => controller.abort();
  }, [slug, attempt]);

  // Lock page scroll while open.
  useEffect(() => {
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, []);

  // Keep the expanded state in sync with the browser's fullscreen mode.
  useEffect(() => {
    const onChange = () => setExpanded(document.fullscreenElement === panelRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleExpanded = useCallback(async () => {
    const panel = panelRef.current;
    if (!expanded) {
      setExpanded(true);
      if (panel?.requestFullscreen) await panel.requestFullscreen().catch(() => undefined);
    } else {
      setExpanded(false);
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
    }
  }, [expanded]);

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    onClose();
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[75]" role="dialog" aria-modal="true" aria-labelledby="replay-title">
      <button
        type="button"
        aria-label="Close replay"
        tabIndex={-1}
        onClick={close}
        className="absolute inset-0 animate-[vt-fade_200ms_ease-out] bg-ink-950/35 backdrop-blur-[2px] dark:bg-black/60"
      />
      <div
        ref={panelRef}
        className={cn(
          "absolute flex animate-[rise-in_320ms_var(--ease-out-soft)] flex-col overflow-y-auto bg-page shadow-[var(--shadow-lift)]",
          expanded ? "inset-0" : "inset-0 sm:inset-4 sm:rounded-[var(--radius-hero)] lg:inset-x-8 lg:inset-y-6",
        )}
      >
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-page/90 px-4 py-3 backdrop-blur sm:px-8">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-700">Market Replay</span>
            {load.state === "ready" && load.data.source === "demo" && (
              <span className="rounded-full border border-dashed border-ink-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-600">
                Demo data
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={toggleExpanded}
              aria-label={expanded ? "Exit presentation mode" : "Presentation mode"}
              title={expanded ? "Exit presentation mode (Esc)" : "Presentation mode"}
              className="rounded-full p-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              {expanded ? <Minimize2 className="size-4" aria-hidden /> : <Maximize2 className="size-4" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={close}
              aria-label="Close replay"
              title="Close (Esc)"
              className="rounded-full p-2 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 sm:px-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">{startupName}</p>
          <h2 id="replay-title" className="mt-1 max-w-4xl font-display text-2xl font-bold leading-tight text-ink-900 sm:text-3xl">
            {question}
          </h2>

          {load.state === "loading" && (
            <div role="status" aria-label="Loading replay" className="mt-6 space-y-6">
              <Skeleton className="h-6 w-48" />
              <div className="grid grid-cols-3 gap-6">
                {[0, 1, 2].map((key) => (
                  <Skeleton key={key} className="h-16" />
                ))}
              </div>
              <Skeleton className="h-72 rounded-[var(--radius-card)]" />
            </div>
          )}

          {load.state === "error" && (
            <div className="mt-8">
              <ReplayEmptyState
                title="Replay could not load"
                body="Something went wrong fetching this market's history."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLoad({ state: "loading" });
                      setAttempt((count) => count + 1);
                    }}
                  >
                    Try again
                  </Button>
                }
              />
            </div>
          )}

          {load.state === "ready" && <ReplayBody data={load.data} expanded={expanded} onEscape={expanded ? toggleExpanded : close} />}
        </div>
      </div>
    </div>
  );
}

function ReplayBody({ data, expanded, onEscape }: { data: ReplayData; expanded: boolean; onEscape: () => void }) {
  const [now] = useState(requestTime);
  const available = useMemo(() => availability(data.points), [data.points]);
  const replayable = canReplay(data.points);
  const keyTimes = useMemo(
    () => [...data.points.map((point) => point.at), ...data.events.map((event) => event.at)],
    [data.points, data.events],
  );
  const clock = useReplayClock(data.start, data.end, keyTimes);
  const [selected, setSelected] = useState<ReplayEvent | null>(null);
  const [compare, setCompare] = useState<{ a: number; b: number } | null>(null);

  const move = useMemo(() => biggestMove(data.points), [data.points]);
  const divergence = useMemo(() => biggestDivergence(data.points), [data.points]);
  const state = stateAt(data.points, clock.time);
  const first = data.points.find((point) => point.model !== null || point.general !== null || point.verified !== null) ?? null;
  // Default compare start: the first moment where every available signal has a value.
  const firstComplete =
    data.points.find((point) => (["model", "general", "verified"] as const).every((key) => !available[key] || point[key] !== null)) ?? first;
  const final = data.points[data.points.length - 1] ?? null;

  const jumpTo = useCallback(
    (time: number) => {
      clock.pause();
      clock.setTime(time);
    },
    [clock],
  );

  const step = useCallback(
    (direction: -1 | 1) => {
      const target = stepTarget(keyTimes, clock.time, direction);
      if (target !== null) jumpTo(target);
    },
    [keyTimes, clock.time, jumpTo],
  );

  const selectEvent = useCallback(
    (event: ReplayEvent) => {
      jumpTo(event.at);
      setSelected(event);
    },
    [jumpTo],
  );

  // Space, arrows, and Escape anywhere in the replay (buttons keep their own Space).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const interactive = /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(target.tagName) || target.getAttribute("role") === "slider";
      if (event.key === "Escape") {
        event.preventDefault();
        onEscape();
      } else if (event.key === " " && !interactive) {
        event.preventDefault();
        if (clock.playing) clock.pause();
        else clock.play();
      } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && target.getAttribute("role") !== "slider") {
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clock, step, onEscape]);

  // Focus the play button when the replay opens.
  useEffect(() => {
    if (replayable) document.querySelector<HTMLButtonElement>("[data-replay-play]")?.focus();
  }, [replayable]);

  if (data.market.opensAt > now) {
    return (
      <div className="mt-8">
        <ReplayEmptyState title="This market has not opened yet" body={`It opens ${formatLongDate(data.market.opensAt)}.`} />
      </div>
    );
  }
  if (!replayable) {
    const missing = (["model", "general", "verified"] as const).filter((key) => !available[key]);
    return (
      <div className="mt-8">
        <ReplayEmptyState
          title="Not enough history to replay yet."
          body={
            missing.length === 3
              ? "Replay needs at least two recorded moments of the Senzi Model, General Users, or Verified Users."
              : "Replay needs at least two recorded moments."
          }
        />
      </div>
    );
  }

  const endLabel = data.resolution
    ? `Resolved ${formatLongDate(data.resolution.resolvedAt).replace(/, \d{4}$/, "")}`
    : data.end >= now - 3_600_000
      ? "Today"
      : formatLongDate(data.end).replace(/, \d{4}$/, "");
  const missingNotes = (["model", "general", "verified"] as const).filter((key) => !available[key]);

  return (
    <div className="mt-2">
      <p className="font-display text-lg font-semibold tabular-nums text-ink-600" aria-live="off">
        {formatLongDate(clock.time)}
      </p>

      <div className="mt-6">
        <ReplayStats state={state} first={first} available={available} />
        {missingNotes.length > 0 && (
          <p className="mt-2 text-xs text-ink-500">
            No {missingNotes.map((key) => ({ model: "Senzi Model", general: "General Users", verified: "Verified Users" })[key]).join(" or ")} history
            recorded for this market yet.
          </p>
        )}
      </div>

      <div className={cn("mt-6 grid gap-6", !expanded && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
        <div className="min-w-0 space-y-4">
          <div className="surface-card relative p-4 sm:p-5">
            <ReplayChart data={data} time={clock.time} available={available} compare={compare} tall={expanded} />
            {clock.atEnd && data.resolution && <ResolvedCard data={data} final={final} />}
          </div>
          <ReplayTimeline
            start={data.start}
            end={data.end}
            time={clock.time}
            events={data.events}
            selectedEventId={selected?.id ?? null}
            compare={compare}
            endLabel={endLabel}
            onScrub={(time) => {
              clock.pause();
              clock.setTime(time);
            }}
            onStep={step}
            onSelectEvent={selectEvent}
          />
          <ReplayControls
            playing={clock.playing}
            atEnd={clock.atEnd}
            speed={clock.speed}
            canStepBack={stepTarget(keyTimes, clock.time, -1) !== null}
            canStepForward={stepTarget(keyTimes, clock.time, 1) !== null}
            biggestMoveReason={move ? null : "Not enough history to find a move"}
            biggestDivergenceReason={divergence ? null : "Needs two signals recorded at the same time"}
            compareOn={compare !== null}
            onPlay={clock.play}
            onPause={clock.pause}
            onRestart={() => {
              clock.setTime(data.start);
              clock.play();
            }}
            onStep={step}
            onLatest={() => jumpTo(data.end)}
            onSpeed={clock.setSpeed}
            onBiggestMove={() => move && jumpTo(move.at)}
            onBiggestDivergence={() => divergence && jumpTo(divergence.at)}
            onToggleCompare={() =>
              setCompare((current) =>
                current
                  ? null
                  : {
                      a: firstComplete?.at ?? data.start,
                      b: clock.time > (firstComplete?.at ?? data.start) ? clock.time : data.end,
                    },
              )
            }
          />
        </div>

        <aside className={cn("space-y-6", expanded && "grid gap-6 space-y-0 md:grid-cols-2")}>
          {selected && (
            <div className="surface-card p-4">
              <ReplayEventPanel event={selected} onClose={() => setSelected(null)} />
            </div>
          )}
          {compare && (
            <div className="surface-card p-4">
              <CompareMoments
                data={data.points}
                a={compare.a}
                b={compare.b}
                available={available}
                onSetA={() => setCompare((current) => (current ? { ...current, a: clock.time } : current))}
                onSetB={() => setCompare((current) => (current ? { ...current, b: clock.time } : current))}
              />
            </div>
          )}
          <section aria-labelledby="replay-events-heading">
            <h3 id="replay-events-heading" className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
              Events
            </h3>
            <ReplayEventList events={data.events} time={clock.time} selectedId={selected?.id ?? null} onSelect={selectEvent} />
          </section>
          {!expanded && (
            <section aria-labelledby="replay-activity-heading">
              <h3 id="replay-activity-heading" className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">
                Forecast activity
              </h3>
              <ReplayActivity data={data} time={clock.time} />
            </section>
          )}
        </aside>
      </div>

      <p className="mt-8 text-xs text-ink-500">
        Space to play or pause. Arrow keys to step. Esc to close. Values are research signals, not guarantees.
      </p>
    </div>
  );
}
