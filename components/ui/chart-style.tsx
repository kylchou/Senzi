import type { ChartMode } from "./a11y/keys";
import { cn } from "./cn";

/**
 * Shared line styles for every Senzi chart. In the default mode lines differ
 * by color and weight (and every chart labels them). With Chart Accessibility
 * set to Color-Blind Friendly or High Contrast, each line also gets its own
 * pattern (solid, dashed, dotted) and marker shape, so no line is told apart
 * by color alone.
 */
export type ChartSeries = "model" | "general" | "verified" | "allocation" | "calibrated" | "baseline";
export type MarkerShape = "circle" | "square" | "triangle";

export interface LineStyle {
  stroke: string;
  fill: string;
  width: number;
  dash?: string;
  /** Round caps turn a near-zero dash into dots. */
  cap: "round" | "butt";
  marker: MarkerShape;
}

const DASHED = "8 5";
const DOTTED = "0.1 6";

const line = (stroke: string, fill: string, width: number, marker: MarkerShape, dash?: string): LineStyle => ({
  stroke,
  fill,
  width,
  dash,
  cap: dash === DOTTED ? "round" : "butt",
  marker,
});

const STYLES: Record<ChartMode, Record<ChartSeries, LineStyle>> = {
  default: {
    model: line("stroke-ink-500", "fill-ink-500", 2, "circle", "6 5"),
    general: line("stroke-red-500", "fill-red-500", 2, "square"),
    verified: line("stroke-ink-900", "fill-ink-900", 2.75, "triangle"),
    allocation: line("stroke-red-500", "fill-red-500", 2, "circle"),
    calibrated: line("stroke-ink-900", "fill-ink-900", 1.5, "square"),
    baseline: line("stroke-ink-500", "fill-ink-500", 1.5, "triangle", "5 5"),
  },
  cvd: {
    model: line("stroke-ink-500", "fill-ink-500", 2.5, "circle"),
    general: line("stroke-red-500", "fill-red-500", 2.5, "square", DASHED),
    verified: line("stroke-ink-900", "fill-ink-900", 3.25, "triangle", DOTTED),
    allocation: line("stroke-red-500", "fill-red-500", 2.5, "circle"),
    calibrated: line("stroke-ink-900", "fill-ink-900", 2, "square", DASHED),
    baseline: line("stroke-ink-500", "fill-ink-500", 2.25, "triangle", DOTTED),
  },
  contrast: {
    model: line("stroke-ink-700", "fill-ink-700", 3, "circle"),
    general: line("stroke-red-600", "fill-red-600", 3, "square", DASHED),
    verified: line("stroke-ink-950", "fill-ink-950", 3.75, "triangle", DOTTED),
    allocation: line("stroke-red-600", "fill-red-600", 3, "circle"),
    calibrated: line("stroke-ink-950", "fill-ink-950", 2.5, "square", DASHED),
    baseline: line("stroke-ink-700", "fill-ink-700", 2.5, "triangle", DOTTED),
  },
};

export function lineStyle(series: ChartSeries, mode: ChartMode): LineStyle {
  return STYLES[mode][series];
}

/** Marker shapes appear along lines and in legends outside the default mode. */
export const showsMarkers = (mode: ChartMode) => mode !== "default";

/** Evenly spaced positions along [from, to] for line markers, excluding the ends. */
export function markerTimes(from: number, to: number, count = 6): number[] {
  if (to <= from) return [];
  return Array.from({ length: count }, (_, index) => from + ((index + 1) / (count + 1)) * (to - from));
}

export function SeriesMarker({
  shape,
  x,
  y,
  size = 4.5,
  className,
}: {
  shape: MarkerShape;
  x: number;
  y: number;
  size?: number;
  className?: string;
}) {
  const shared = { className: cn("stroke-surface", className), strokeWidth: 1.5 };
  if (shape === "square") return <rect x={x - size} y={y - size} width={size * 2} height={size * 2} rx={1} {...shared} />;
  if (shape === "triangle") {
    const h = size * 1.15;
    return <path d={`M${x},${y - h}L${x + h},${y + h * 0.75}L${x - h},${y + h * 0.75}Z`} strokeLinejoin="round" {...shared} />;
  }
  return <circle cx={x} cy={y} r={size} {...shared} />;
}

/** Legend sample that matches the line exactly: color, weight, pattern, and marker. */
export function LineSwatch({ style, mode, className }: { style: LineStyle; mode: ChartMode; className?: string }) {
  return (
    <svg viewBox="0 0 26 12" className={cn("h-3 w-[26px] shrink-0 overflow-visible", className)} aria-hidden>
      <line
        x1={1}
        x2={25}
        y1={6}
        y2={6}
        className={style.stroke}
        strokeWidth={Math.min(style.width, 3)}
        strokeDasharray={style.dash}
        strokeLinecap={style.cap}
      />
      {showsMarkers(mode) && <SeriesMarker shape={style.marker} x={13} y={6} size={3.25} className={style.fill} />}
    </svg>
  );
}
