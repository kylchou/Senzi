import type { SeriesKey } from "@/lib/market-view/replay";

/**
 * Names for the three signals. Line color, weight, pattern, and marker come
 * from the shared chart styles (components/ui/chart-style.tsx), and every place
 * a line appears also carries its text label, so the signals are never told
 * apart by color alone.
 */
export const SERIES_STYLE: Record<SeriesKey, { label: string; short: string }> = {
  model: { label: "Senzi Model", short: "Model" },
  general: { label: "General Users", short: "General" },
  verified: { label: "Verified Users", short: "Verified" },
};

export const percent = (value: number | null) => (value === null ? "N/A" : `${Math.round(value * 100)}%`);

export const points = (delta: number | null) => {
  if (delta === null) return "N/A";
  const rounded = Math.round(delta * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}`;
};
