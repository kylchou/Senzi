"use client";

import { ChevronLeft, ChevronRight, GitCompareArrows, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { cn } from "../cn";
import { SPEEDS, type Speed } from "./useReplayClock";

function IconButton({
  label,
  shortcut,
  onClick,
  disabled,
  children,
  className,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cn(
        "inline-flex size-10 items-center justify-center rounded-full text-ink-700 transition-[color,background-color,transform] duration-150 hover:bg-ink-100 hover:text-ink-900 active:scale-95 disabled:pointer-events-none disabled:opacity-35",
        className,
      )}
    >
      {children}
    </button>
  );
}

function MomentButton({
  label,
  disabledReason,
  onClick,
}: {
  label: string;
  disabledReason: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabledReason !== null}
      title={disabledReason ?? label}
      className="h-8 shrink-0 rounded-full border border-hairline bg-surface px-3.5 text-xs font-semibold text-ink-700 shadow-[var(--shadow-card)] transition-[color,border-color,transform] duration-150 hover:border-ink-300 hover:text-ink-900 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
    >
      {label}
    </button>
  );
}

export function ReplayControls({
  playing,
  atEnd,
  speed,
  canStepBack,
  canStepForward,
  biggestMoveReason,
  biggestDivergenceReason,
  compareOn,
  onPlay,
  onPause,
  onRestart,
  onStep,
  onLatest,
  onSpeed,
  onBiggestMove,
  onBiggestDivergence,
  onToggleCompare,
}: {
  playing: boolean;
  atEnd: boolean;
  speed: Speed;
  canStepBack: boolean;
  canStepForward: boolean;
  /** Null when available; otherwise why the jump is disabled. */
  biggestMoveReason: string | null;
  biggestDivergenceReason: string | null;
  compareOn: boolean;
  onPlay: () => void;
  onPause: () => void;
  onRestart: () => void;
  onStep: (direction: -1 | 1) => void;
  onLatest: () => void;
  onSpeed: (speed: Speed) => void;
  onBiggestMove: () => void;
  onBiggestDivergence: () => void;
  onToggleCompare: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 sm:justify-start">
        <div className="flex items-center gap-0.5">
          <IconButton label="Restart" onClick={onRestart}>
            <RotateCcw className="size-4" aria-hidden />
          </IconButton>
          <IconButton label="Step back" shortcut="Left arrow" onClick={() => onStep(-1)} disabled={!canStepBack}>
            <ChevronLeft className="size-5" aria-hidden />
          </IconButton>
          <button
            type="button"
            data-replay-play
            onClick={playing ? onPause : onPlay}
            aria-label={playing ? "Pause" : atEnd ? "Replay from start" : "Play"}
            title={`${playing ? "Pause" : "Play"} (Space)`}
            className="mx-1 inline-flex size-12 items-center justify-center rounded-full bg-ink-900 text-surface shadow-[var(--shadow-lift)] transition-[background-color,transform] duration-150 hover:bg-ink-800 active:scale-95"
          >
            {playing ? <Pause className="size-5" aria-hidden /> : <Play className="ml-0.5 size-5" aria-hidden />}
          </button>
          <IconButton label="Step forward" shortcut="Right arrow" onClick={() => onStep(1)} disabled={!canStepForward}>
            <ChevronRight className="size-5" aria-hidden />
          </IconButton>
          <IconButton label="Jump to latest" onClick={onLatest} disabled={atEnd}>
            <SkipForward className="size-4" aria-hidden />
          </IconButton>
        </div>

        <div role="radiogroup" aria-label="Playback speed" className="inline-flex rounded-full bg-ink-100 p-0.5">
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={speed === option}
              onClick={() => onSpeed(option)}
              className={cn(
                "h-8 rounded-full px-2.5 text-xs font-semibold tabular-nums text-ink-600 transition-colors hover:text-ink-900 sm:px-3",
                speed === option && "bg-surface text-ink-900 shadow-[var(--shadow-card)]",
              )}
            >
              {option}x
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <MomentButton label="Biggest move" disabledReason={biggestMoveReason} onClick={onBiggestMove} />
        <MomentButton label="Biggest divergence" disabledReason={biggestDivergenceReason} onClick={onBiggestDivergence} />
        <button
          type="button"
          onClick={onToggleCompare}
          aria-pressed={compareOn}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-[color,background-color,border-color,transform] duration-150 active:scale-95",
            compareOn
              ? "border-ink-900 bg-ink-900 text-surface"
              : "border-hairline bg-surface text-ink-700 shadow-[var(--shadow-card)] hover:border-ink-300 hover:text-ink-900",
          )}
        >
          <GitCompareArrows className="size-3.5" aria-hidden />
          Compare moments
        </button>
      </div>
    </div>
  );
}
