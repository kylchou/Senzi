import type { AlertType, StudyStatus, StudyVisibility } from "./types";

const dateFmt = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const asDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));

export const formatDate = (d: Date | string | null | undefined) => (d ? dateFmt.format(asDate(d)) : "—");
export const formatDateTime = (d: Date | string | null | undefined) => (d ? dateTimeFmt.format(asDate(d)) : "—");

/** "in 3 days", "5 hours ago" relative to `now`. */
export function formatRelative(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return "—";
  const diff = asDate(d).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "minute") return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(0, "minute");
}

export const STATUS_LABELS: Record<StudyStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  OPEN: "Open",
  CLOSED: "Closed",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export const VISIBILITY_LABELS: Record<StudyVisibility, { label: string; description: string }> = {
  PUBLIC: {
    label: "Public",
    description: "Once open, the question and community estimates are visible to all Senzi users. Notes and reports stay private.",
  },
  ORGANIZATION: {
    label: "Organization",
    description: "Only members of your firm can view and forecast.",
  },
  RESTRICTED: {
    label: "Restricted",
    description: "Only firm admins, the author, and invited participants can view and forecast.",
  },
};

export const ALERT_TYPE_LABELS: Record<AlertType, { label: string; icon: string }> = {
  FORECAST_MOVEMENT: { label: "Forecast movement", icon: "↕" },
  DEADLINE_APPROACHING: { label: "Deadline", icon: "⏱" },
  STUDY_RESOLVED: { label: "Resolved", icon: "✓" },
  STUDY_STATUS_CHANGED: { label: "Status change", icon: "●" },
};

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** An indicator value in its unit: "#1,840" for ranks, "$12M" for USD, "1.2M downloads" otherwise. */
export function formatIndicatorValue(value: number | null | undefined, unit: string): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (unit === "rank") return `#${Math.round(value).toLocaleString("en-US")}`;
  if (unit === "USD") return `$${compact.format(value)}`;
  return `${value >= 10_000 ? compact.format(value) : value.toLocaleString("en-US")} ${unit}`;
}

/** Relative change as a signed percentage, e.g. "+12.3%". */
export function formatRelativeChange(change: number | null | undefined): string {
  if (change == null || Number.isNaN(change)) return "—";
  const pct = change * 100;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${Math.abs(pct).toFixed(1)}%`;
}
