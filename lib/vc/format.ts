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
    description: "Once open, the question and community estimates are visible to all VentureCast users. Notes and reports stay private.",
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
