/**
 * Market Replay: pure functions over the same MarketSnapshot records the
 * market chart uses. No second probability history is stored anywhere.
 *
 * Signals (all fractions in [0, 1]):
 * - model:    MarketSnapshot.modelValue (Senzi model)
 * - general:  MarketSnapshot.generalEstimate (all forecasters)
 * - verified: MarketSnapshot.specializedEstimate (verified users only)
 */

export const SERIES = ["model", "general", "verified"] as const;
export type SeriesKey = (typeof SERIES)[number];

export const SERIES_LABEL: Record<SeriesKey, string> = {
  model: "Senzi Model",
  general: "General Users",
  verified: "Verified Users",
};

const DAY = 86_400_000;

export interface ReplayPoint {
  /** Epoch milliseconds. */
  at: number;
  model: number | null;
  general: number | null;
  verified: number | null;
  /** Forecasts recorded so far (cumulative). */
  forecasts: number;
  /** Credits allocated so far, YES plus NO (cumulative). */
  credits: number;
}

export type ReplayEventKind = "opened" | "baseline" | "news" | "move" | "divergence" | "resolved" | "demo";

export interface ReplayEvent {
  id: string;
  at: number;
  kind: ReplayEventKind;
  title: string;
  detail?: string;
  url?: string;
  /** real: a stored record. derived: computed from the history. demo: illustrative only. */
  origin: "real" | "derived" | "demo";
}

/** Forecast counts in a time bucket, aggregated so individual trades never crowd the chart. */
export interface ActivityBucket {
  start: number;
  end: number;
  yes: number;
  no: number;
  yesCredits: number;
  noCredits: number;
  verified: number;
}

export interface ReplayData {
  /** "demo" only when the demo fallback is switched on and real history is missing. */
  source: "real" | "demo";
  market: {
    slug: string;
    question: string;
    startupName: string;
    status: "OPEN" | "CLOSED" | "RESOLVED" | "CANCELLED";
    opensAt: number;
    closesAt: number;
  };
  start: number;
  end: number;
  points: ReplayPoint[];
  events: ReplayEvent[];
  /** Null when forecast history is not available. */
  activity: ActivityBucket[] | null;
  resolution: { outcome: "YES" | "NO" | "VOID"; resolvedAt: number; evidenceUrl: string | null } | null;
}

/** Keep values in [0, 1]; anything else becomes null so the UI never shows NaN. */
export function clean(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) || value < 0 || value > 1 ? null : value;
}

/**
 * Sorts by time and carries each signal forward from its last known value,
 * since a snapshot that does not mention a signal leaves it unchanged.
 */
export function normalizePoints(points: ReplayPoint[]): ReplayPoint[] {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const last: Record<SeriesKey, number | null> = { model: null, general: null, verified: null };
  return sorted.map((point) => {
    const next = { ...point };
    for (const key of SERIES) {
      const value = clean(point[key]);
      if (value !== null) last[key] = value;
      next[key] = last[key];
    }
    return next;
  });
}

export function availability(points: ReplayPoint[]): Record<SeriesKey, boolean> {
  return {
    model: points.some((point) => point.model !== null),
    general: points.some((point) => point.general !== null),
    verified: points.some((point) => point.verified !== null),
  };
}

/** Enough to replay: at least two moments with at least one signal. */
export function canReplay(points: ReplayPoint[]): boolean {
  return points.filter((point) => SERIES.some((key) => point[key] !== null)).length >= 2;
}

/** Index of the last point at or before `time`, or -1. */
export function indexAt(points: ReplayPoint[], time: number): number {
  let low = 0;
  let high = points.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (points[mid].at <= time) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** The replay state at a moment (values in effect then). */
export function stateAt(points: ReplayPoint[], time: number): ReplayPoint | null {
  const index = indexAt(points, time);
  return index < 0 ? null : points[index];
}

export function valueAt(points: ReplayPoint[], time: number, key: SeriesKey): number | null {
  return stateAt(points, time)?.[key] ?? null;
}

/** Largest gap between any two available signals at a point. */
export function widestGap(point: ReplayPoint): { a: SeriesKey; b: SeriesKey; gap: number } | null {
  let best: { a: SeriesKey; b: SeriesKey; gap: number } | null = null;
  for (let i = 0; i < SERIES.length; i++) {
    for (let j = i + 1; j < SERIES.length; j++) {
      const a = point[SERIES[i]];
      const b = point[SERIES[j]];
      if (a === null || b === null) continue;
      const gap = Math.abs(a - b);
      if (!best || gap > best.gap) best = { a: SERIES[i], b: SERIES[j], gap };
    }
  }
  return best;
}

export interface Move {
  at: number;
  series: SeriesKey;
  from: number;
  to: number;
  delta: number;
}

/**
 * The largest change in any one signal over a `windowDays` window, ending at
 * a snapshot. Ignores moves smaller than `min` (default 2 points).
 */
export function biggestMove(points: ReplayPoint[], windowDays = 3, min = 0.02): Move | null {
  let best: Move | null = null;
  for (const point of points) {
    for (const series of SERIES) {
      const to = point[series];
      const from = valueAt(points, point.at - windowDays * DAY, series) ?? firstValue(points, series);
      if (to === null || from === null) continue;
      const delta = to - from;
      if (Math.abs(delta) >= min && (!best || Math.abs(delta) > Math.abs(best.delta))) {
        best = { at: point.at, series, from, to, delta };
      }
    }
  }
  return best;
}

function firstValue(points: ReplayPoint[], series: SeriesKey): number | null {
  return points.find((point) => point[series] !== null)?.[series] ?? null;
}

/** The moment with the widest gap between two signals. Needs two signals at once. */
export function biggestDivergence(points: ReplayPoint[]): { at: number; a: SeriesKey; b: SeriesKey; gap: number } | null {
  let best: { at: number; a: SeriesKey; b: SeriesKey; gap: number } | null = null;
  for (const point of points) {
    const gap = widestGap(point);
    if (gap && gap.gap > 0 && (!best || gap.gap > best.gap)) best = { at: point.at, ...gap };
  }
  return best;
}

export interface MomentComparison {
  rows: { series: SeriesKey; from: number | null; to: number | null; delta: number | null }[];
  /** Change in the gap between each available pair, largest first. */
  gaps: { a: SeriesKey; b: SeriesKey; from: number; to: number; delta: number }[];
}

/** Purely numeric comparison of two moments. */
export function compareMoments(points: ReplayPoint[], fromTime: number, toTime: number): MomentComparison {
  const a = stateAt(points, fromTime);
  const b = stateAt(points, toTime);
  const rows = SERIES.map((series) => {
    const from = a?.[series] ?? null;
    const to = b?.[series] ?? null;
    return { series, from, to, delta: from !== null && to !== null ? to - from : null };
  }).sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0));

  const gaps: MomentComparison["gaps"] = [];
  for (let i = 0; i < SERIES.length; i++) {
    for (let j = i + 1; j < SERIES.length; j++) {
      const [s1, s2] = [SERIES[i], SERIES[j]];
      const fromA = a?.[s1] ?? null;
      const fromB = a?.[s2] ?? null;
      const toA = b?.[s1] ?? null;
      const toB = b?.[s2] ?? null;
      if (fromA === null || fromB === null || toA === null || toB === null) continue;
      // Orient the gap so it reads "higher minus lower" at the later moment.
      const sign = toA >= toB ? 1 : -1;
      const [hi, lo] = sign === 1 ? [s1, s2] : [s2, s1];
      const from = sign * (fromA - fromB);
      const to = sign * (toA - toB);
      gaps.push({ a: hi, b: lo, from, to, delta: to - from });
    }
  }
  gaps.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return { rows, gaps };
}

/**
 * Events computed from the history itself: sharp moves in a signal and the
 * moment two signals first split apart. These are facts about the data, not
 * explanations.
 */
export function derivedEvents(points: ReplayPoint[], moveMin = 0.1, gapMin = 0.15, windowDays = 3): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  const lastMoveAt: Partial<Record<SeriesKey, number>> = {};
  for (const point of points) {
    for (const series of SERIES) {
      const to = point[series];
      const from = valueAt(points, point.at - windowDays * DAY, series);
      if (to === null || from === null) continue;
      const delta = to - from;
      const recent = lastMoveAt[series];
      if (Math.abs(delta) >= moveMin && (recent === undefined || point.at - recent > windowDays * DAY)) {
        lastMoveAt[series] = point.at;
        const points100 = Math.round(delta * 100);
        events.push({
          id: `move-${series}-${point.at}`,
          at: point.at,
          kind: "move",
          origin: "derived",
          title: `${SERIES_LABEL[series]} ${points100 > 0 ? "+" : ""}${points100} pts`,
          detail: `${Math.round(from * 100)}% to ${Math.round(to * 100)}% in ${windowDays} days`,
        });
      }
    }
  }
  let wasWide = false;
  for (const point of points) {
    const gap = widestGap(point);
    const wide = gap !== null && gap.gap >= gapMin;
    if (wide && !wasWide && gap) {
      events.push({
        id: `divergence-${point.at}`,
        at: point.at,
        kind: "divergence",
        origin: "derived",
        title: `${SERIES_LABEL[gap.a]} and ${SERIES_LABEL[gap.b]} split`,
        detail: `${Math.round(gap.gap * 100)} point gap`,
      });
    }
    wasWide = wide;
  }
  return events.sort((a, b) => a.at - b.at);
}

/**
 * Playback map. Quiet stretches (long gaps with no snapshots or events) play
 * faster, but time only ever moves forward, so the timeline stays accurate.
 */
export function playbackMap(keyTimes: number[], start: number, end: number) {
  const span = Math.max(1, end - start);
  const cap = Math.max(span / 14, 1);
  const times = [start, ...keyTimes.filter((time) => time > start && time < end).sort((a, b) => a - b), end];
  const weights = times.slice(1).map((time, index) => Math.min(time - times[index], cap));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const cumulative = [0];
  for (const weight of weights) cumulative.push(cumulative[cumulative.length - 1] + weight / total);

  return {
    /** Playback progress (0 to 1) to a timestamp. */
    timeAt(progress: number): number {
      const p = Math.min(1, Math.max(0, progress));
      for (let i = 1; i < cumulative.length; i++) {
        if (p <= cumulative[i]) {
          const local = (p - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1] || 1);
          return times[i - 1] + local * (times[i] - times[i - 1]);
        }
      }
      return end;
    },
    /** A timestamp to playback progress (0 to 1). */
    progressAt(time: number): number {
      const t = Math.min(end, Math.max(start, time));
      for (let i = 1; i < times.length; i++) {
        if (t <= times[i]) {
          const local = (t - times[i - 1]) / (times[i] - times[i - 1] || 1);
          return cumulative[i - 1] + local * (cumulative[i] - cumulative[i - 1]);
        }
      }
      return 1;
    },
  };
}

/** Previous and next stops for stepping: snapshot and event times. */
export function stepTarget(stops: number[], time: number, direction: -1 | 1): number | null {
  const sorted = [...new Set(stops)].sort((a, b) => a - b);
  if (direction === 1) return sorted.find((stop) => stop > time + 1) ?? null;
  for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i] < time - 1) return sorted[i];
  return null;
}

/** Activity buckets that ended within the trailing `windowMs` before `time`. */
export function recentActivity(activity: ActivityBucket[] | null, time: number, windowMs = DAY) {
  if (!activity) return null;
  const inWindow = activity.filter((bucket) => bucket.start <= time && bucket.start > time - windowMs);
  return inWindow.reduce(
    (sum, bucket) => ({
      yes: sum.yes + bucket.yes,
      no: sum.no + bucket.no,
      yesCredits: sum.yesCredits + bucket.yesCredits,
      noCredits: sum.noCredits + bucket.noCredits,
      verified: sum.verified + bucket.verified,
    }),
    { yes: 0, no: 0, yesCredits: 0, noCredits: 0, verified: 0 },
  );
}
