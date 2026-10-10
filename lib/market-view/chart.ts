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

/** Vertical range the chart zooms to, with evenly spaced gridline values. */
export interface ChartDomain {
  min: number;
  max: number;
  ticks: number[];
}

export interface ChartGeometry {
  /** YES allocation share points, used for hover. */
  points: PlottedPoint[];
  path: string;
  /** Line for the calibrated probability, or null when none is recorded. */
  calibratedPath: string | null;
  domain: ChartDomain;
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

/**
 * Straight segments from point to point, like a stock chart, then flat from
 * the latest value to now (nothing has traded since).
 */
function linePath(coords: { x: number; y: number }[], endX: number): string {
  let path = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let index = 1; index < coords.length; index++) {
    path += `L${coords[index].x.toFixed(1)},${coords[index].y.toFixed(1)}`;
  }
  return path + `H${endX.toFixed(1)}`;
}

const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25];
const round = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * Zooms the axis to where the values actually are, so moves are visible
 * (a fixed 0 to 100% axis makes a 5-point swing look flat). Keeps at least a
 * 10-point window, snaps to round gridlines, and stays within 0 to 100%.
 */
export function yDomain(values: number[]): ChartDomain {
  if (values.length === 0) return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  let low = Math.min(...values);
  let high = Math.max(...values);
  const pad = Math.max((high - low) * 0.15, 0.02);
  low -= pad;
  high += pad;
  if (high - low < 0.1) {
    const middle = (low + high) / 2;
    low = middle - 0.05;
    high = middle + 0.05;
  }
  for (const step of TICK_STEPS) {
    const min = Math.max(0, Math.floor(round(low / step)) * step);
    const max = Math.min(1, Math.ceil(round(high / step)) * step);
    if (round((max - min) / step) <= 5) {
      const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) => round(min + index * step));
      return { min: round(min), max: round(max), ticks };
    }
  }
  return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
}

/** Line paths and a y-axis zoomed to the data (and the baseline, when given). */
/**
 * The credit share from the first few forecasters swings between 0% and 100%
 * (one YES forecast is 100%), so the line starts once this many have taken
 * part. Crowd estimates stop improving much past 10 to 20 participants. This
 * also keeps an early spike from stretching the zoomed axis. Markets that
 * never reach it show every point. The data table lists all.
 */
export const MIN_FORECASTERS_FOR_LINE = 15;

export function settledPoints<T extends { forecasterCount: number }>(points: T[]): T[] {
  const from = points.findIndex((point) => point.forecasterCount >= MIN_FORECASTERS_FOR_LINE);
  return from > 0 && points.length - from >= 2 ? points.slice(from) : points;
}

export function buildGeometry(
  history: HistoryPoint[],
  box: ChartBox,
  now: number = Date.now(),
  baseline: number | null = null,
): ChartGeometry | null {
  const data = downsample(settledPoints(plottable(history)), 400);
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

  const domain = yDomain([
    ...data.map((point) => point.share),
    ...calibrated.map((point) => point.calibrated),
    ...(baseline !== null ? [baseline] : []),
  ]);
  const xFor = (time: number) => box.padding.left + ((time - start) / (end - start)) * innerW;
  const yFor = (share: number) => box.padding.top + (1 - (share - domain.min) / (domain.max - domain.min)) * innerH;

  const points = data.map((point) => ({ x: xFor(Date.parse(point.at)), y: yFor(point.share), point }));
  const calibratedPath = calibrated.length
    ? linePath(
        calibrated.map((point) => ({ x: xFor(Date.parse(point.at)), y: yFor(point.calibrated) })),
        xFor(end),
      )
    : null;

  return { points, path: linePath(points, xFor(end)), calibratedPath, domain, start, end, xFor, yFor };
}

/** Index of the plotted point closest to x, for hovering along the line. */
export function nearestIndex(points: PlottedPoint[], x: number): number {
  let low = 0;
  let high = points.length - 1;
  if (x <= points[0].x) return 0;
  if (x >= points[high].x) return high;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid].x <= x) low = mid;
    else high = mid;
  }
  return x - points[low].x <= points[high].x - x ? low : high;
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
  { key: "1d", label: "1D", days: 1, since: "past day" },
  { key: "7d", label: "7D", days: 7, since: "past week" },
  { key: "30d", label: "30D", days: 30, since: "past month" },
  { key: "all", label: "All", days: null, since: "since open" },
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
