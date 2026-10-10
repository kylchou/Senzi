import type { SeriesKey } from "@/lib/market-view/replay";

/**
 * Line styles for the three signals. Each differs by color, dash pattern, and
 * weight, and every place a line appears also carries its text label, so the
 * signals are never told apart by color alone.
 */
export const SERIES_STYLE: Record<
  SeriesKey,
  { label: string; short: string; stroke: string; width: number; dash?: string; swatch: string }
> = {
  model: {
    label: "Senzi Model",
    short: "Model",
    stroke: "stroke-ink-500",
    width: 2,
    dash: "6 5",
    swatch: "border-t-2 border-dashed border-ink-500",
  },
  general: {
    label: "General Users",
    short: "General",
    stroke: "stroke-red-500",
    width: 2,
    swatch: "h-0.5 rounded-full bg-red-500",
  },
  verified: {
    label: "Verified Users",
    short: "Verified",
    stroke: "stroke-ink-900",
    width: 2.75,
    swatch: "h-[3px] rounded-full bg-ink-900",
  },
};

export const percent = (value: number | null) => (value === null ? "N/A" : `${Math.round(value * 100)}%`);

export const points = (delta: number | null) => {
  if (delta === null) return "N/A";
  const rounded = Math.round(delta * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
};
