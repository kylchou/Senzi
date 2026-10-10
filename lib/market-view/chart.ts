import type { HistoryPoint } from "./types";

export interface ChartBox {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface PlottedPoint {
  x: number;
  y: number;
  point: HistoryPoint & { share: number };
}

export interface ChartGeometry {
  /** YES allocation share points, used for hover. */
  points: PlottedPoint[];
  path: string;
  /** Step path for the calibrated probability, or null when none is recorded. */
  calibratedPath: string | null;
  start: number;
  end: number;
  xFor: (time: number) => number;
  yFor: (share: number) => number;
}

/** Keeps only points with a share, sorted by time. */
export function plottable(points: HistoryPoint[]): (HistoryPoint & { share: number })[] {
  return points
    .filter((point): point is HistoryPoint & { share: number } => point.share !== null)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Even-stride downsample that always keeps the first and last point. */
export function downsample<T>(items: T[], max: number): T[] {
  if (items.length <= max || max < 2) return items;
  const stride = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => items[Math.round(index * stride)]);
}

function stepPath(coords: { x: number; y: number }[], endX: number): string {
  let path = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let index = 1; index < coords.length; index++) {
    path += `H${coords[index].x.toFixed(1)}V${coords[index].y.toFixed(1)}`;
  }
  return path + `H${endX.toFixed(1)}`;
}

/** Step paths so each line holds its value until the next snapshot. */
export function buildGeometry(history: HistoryPoint[], box: ChartBox, now: number = Date.now()): ChartGeometry | null {
  const data = downsample(plottable(history), 400);
  if (data.length === 0) return null;
  const calibrated = downsample(
    history
      .filter((point): point is HistoryPoint & { calibrated: number } => point.calibrated !== null)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
    400,
  );

  const start = Math.min(Date.parse(data[0].at), calibrated.length ? Date.parse(calibrated[0].at) : Infinity);
  const end = Math.max(now, Date.parse(data[data.length - 1].at), start + 1);
  const innerW = box.width - box.padding.left - box.padding.right;
  const innerH = box.height - box.padding.top - box.padding.bottom;

  const xFor = (time: number) => box.padding.left + ((time - start) / (end - start)) * innerW;
  const yFor = (share: number) => box.padding.top + (1 - share) * innerH;

  const points = data.map((point) => ({ x: xFor(Date.parse(point.at)), y: yFor(point.share), point }));
  const calibratedPath = calibrated.length
    ? stepPath(
        calibrated.map((point) => ({ x: xFor(Date.parse(point.at)), y: yFor(point.calibrated) })),
        xFor(end),
      )
    : null;

  return { points, path: stepPath(points, xFor(end)), calibratedPath, start, end, xFor, yFor };
}

/** Index of the plotted point at or before x (step semantics). */
export function nearestIndex(points: PlottedPoint[], x: number): number {
  let low = 0;
  let high = points.length - 1;
  if (x <= points[0].x) return 0;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (points[mid].x <= x) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Up to `count` evenly spaced time ticks between start and end. */
export function timeTicks(start: number, end: number, count = 4): number[] {
  if (end <= start) return [start];
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

/**
 * Change in allocation share between the latest snapshot and the most recent
 * snapshot at least `days` old. Null when there is not enough history.
 */
export function shareMovement(
  history: HistoryPoint[],
  days = 7,
  now: number = Date.now(),
): { delta: number; from: number; to: number; days: number } | null {
  const data = plottable(history);
  if (data.length < 2) return null;
  const cutoff = now - days * 86_400_000;
  const latest = data[data.length - 1];
  let base: (typeof data)[number] | undefined;
  for (const point of data) {
    if (Date.parse(point.at) <= cutoff) base = point;
    else break;
  }
  const span = base
    ? days
    : Math.max(1, Math.round((Date.parse(latest.at) - Date.parse(data[0].at)) / 86_400_000));
  base ??= data[0];
  if (base === latest) return null;
  return { delta: latest.share - base.share, from: base.share, to: latest.share, days: span };
}

export const CHART_RANGES = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "all", label: "All", days: null },
] as const;
export type ChartRangeKey = (typeof CHART_RANGES)[number]["key"];

/**
 * History limited to the last `days` before `end`. The last snapshot before
 * the window is carried to the window start so the step line begins at the
 * value that was current then.
 */
export function sliceHistory(history: HistoryPoint[], days: number | null, end: number): HistoryPoint[] {
  if (days === null) return history;
  const cutoff = end - days * 86_400_000;
  const sorted = [...history].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const inside = sorted.filter((point) => Date.parse(point.at) >= cutoff);
  const before = sorted.filter((point) => Date.parse(point.at) < cutoff).at(-1);
  return before ? [{ ...before, at: new Date(cutoff).toISOString() }, ...inside] : inside;
}

/** Ranges worth offering: only those shorter than the history itself, plus All. */
export function availableRanges(history: HistoryPoint[], end: number): ChartRangeKey[] {
  const first = history.reduce((min, point) => Math.min(min, Date.parse(point.at)), Infinity);
  if (!Number.isFinite(first)) return [];
  const spanDays = (end - first) / 86_400_000;
  const keys = CHART_RANGES.filter((range) => range.days !== null && spanDays > range.days).map((range) => range.key);
  return keys.length ? [...keys, "all"] : [];
}

/** Closed path under a line, for a gradient fill. */
export function areaPath(linePath: string, baselineY: number, startX: number): string {
  return `${linePath}V${baselineY.toFixed(1)}H${startX.toFixed(1)}Z`;
}
