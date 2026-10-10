const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Request time for server components, passed down so every figure on a page uses one clock. */
export function requestTime(): number {
  return Date.now();
}

const STAGE_LABELS: Record<string, string> = {
  PRE_SEED: "Pre-seed",
  SEED: "Seed",
  SERIES_A: "Series A",
  SERIES_B: "Series B",
  SERIES_C: "Series C",
  GROWTH: "Growth",
  PUBLIC: "Public",
  ACQUIRED: "Acquired",
  SHUT_DOWN: "Shut down",
};

export function formatStage(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function formatShare(share: number | null | undefined): string {
  if (share == null || Number.isNaN(share)) return "N/A";
  return `${Math.round(share * 100)}%`;
}

/** Signed change in percentage points, e.g. "+4 pts". */
export function formatPointChange(delta: number): string {
  const points = Math.round(delta * 100);
  if (points === 0) return "0 pts";
  return `${points > 0 ? "+" : ""}${points} pts`;
}

export function formatCredits(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(iso),
  );
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** "Closes in 3 days", "Closed 2 days ago" style deadline label. */
export function formatDeadline(iso: string, now: Date = new Date()): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  let span: string;
  if (abs < HOUR) span = "under an hour";
  else if (abs < DAY) {
    const hours = Math.round(abs / HOUR);
    span = `${hours} ${hours === 1 ? "hour" : "hours"}`;
  } else {
    const days = Math.round(abs / DAY);
    span = `${days} ${days === 1 ? "day" : "days"}`;
  }
  return diff >= 0 ? `Closes in ${span}` : `Closed ${span} ago`;
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (diff < HOUR) return "just now";
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours}h ago`;
  }
  const days = Math.floor(diff / DAY);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function isPastDeadline(iso: string, now: Date = new Date()): boolean {
  return new Date(iso).getTime() <= now.getTime();
}

/** "October 12, 2026" (UTC) for headings. */
export function formatLongDate(time: number | string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(time),
  );
}

/** "Oct 12" (UTC) for compact timeline labels. */
export function formatShortDate(time: number | string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(time));
}
