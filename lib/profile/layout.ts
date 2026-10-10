/**
 * Which profile dashboard sections show, and in what order.
 * Saved in this browser only, so it never touches account data.
 */

export const WIDGETS = {
  summary: "Summary",
  balance: "Balance over time",
  open: "Open forecasts",
  awaiting: "Awaiting resolution",
  settled: "Settled forecasts",
  activity: "Credit activity",
} as const;

export type WidgetId = keyof typeof WIDGETS;

export interface ProfileLayout {
  order: WidgetId[];
  hidden: WidgetId[];
}

const IDS = Object.keys(WIDGETS) as WidgetId[];
const isWidget = (value: unknown): value is WidgetId => typeof value === "string" && value in WIDGETS;

export const DEFAULT_LAYOUT: ProfileLayout = { order: IDS, hidden: [] };

/** Reads a saved layout, dropping unknown ids and adding new sections at the end. */
export function parseLayout(raw: string | null): ProfileLayout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof ProfileLayout, unknown>>;
    const order = Array.isArray(value.order) ? [...new Set(value.order.filter(isWidget))] : [];
    const hidden = Array.isArray(value.hidden) ? [...new Set(value.hidden.filter(isWidget))] : [];
    return { order: [...order, ...IDS.filter((id) => !order.includes(id))], hidden };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function moveWidget(layout: ProfileLayout, id: WidgetId, by: -1 | 1): ProfileLayout {
  const from = layout.order.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[from], order[to]] = [order[to]!, order[from]!];
  return { ...layout, order };
}

export function toggleWidget(layout: ProfileLayout, id: WidgetId): ProfileLayout {
  const hidden = layout.hidden.includes(id) ? layout.hidden.filter((h) => h !== id) : [...layout.hidden, id];
  return { ...layout, hidden };
}
