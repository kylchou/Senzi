"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playbackMap } from "@/lib/market-view/replay";

/** Full replay length at 1x, before quiet stretches are compressed. */
const BASE_DURATION_MS = 16_000;

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

/**
 * Playback clock for a replay. `time` is the replayed timestamp; everything on
 * screen derives from it, so scrubbing, stepping, and playback stay in sync.
 */
export function useReplayClock(start: number, end: number, keyTimes: number[]) {
  const map = useMemo(() => playbackMap(keyTimes, start, end), [keyTimes, start, end]);
  const [time, setTimeState] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const progressRef = useRef(0);

  const setTime = useCallback(
    (next: number) => {
      const clamped = Math.min(end, Math.max(start, next));
      progressRef.current = map.progressAt(clamped);
      setTimeState(clamped);
    },
    [map, start, end],
  );

  const play = useCallback(() => {
    // Playing from the end starts over.
    if (progressRef.current >= 1) {
      progressRef.current = 0;
      setTimeState(start);
    }
    setPlaying(true);
  }, [start]);

  const pause = useCallback(() => setPlaying(false), []);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;
      progressRef.current = Math.min(1, progressRef.current + (elapsed * speed) / BASE_DURATION_MS);
      setTimeState(map.timeAt(progressRef.current));
      if (progressRef.current >= 1) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, map]);

  return { time, setTime, playing, play, pause, speed, setSpeed, atEnd: time >= end };
}

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A number that eases toward its target each frame instead of jumping. Null stays null. */
export function useSmoothed(target: number | null): number | null {
  const [value, setValue] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (target === null || current.current === null || reducedMotion()) {
      current.current = target;
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const from = current.current ?? target;
      const next = from + (target - from) * (1 - Math.exp(-dt / 140));
      current.current = Math.abs(next - target) < 0.0005 ? target : next;
      setValue(current.current);
      if (current.current !== target) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return value;
}
