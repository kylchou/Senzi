// UTC calendar-day helpers. Days are integers (days since 1970-01-01) internally
// and YYYY-MM-DD strings at the edges.

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function toDayNumber(day: string): number {
  if (!ISO_DAY.test(day)) throw new Error(`Invalid day "${day}", expected YYYY-MM-DD`);
  const ms = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid day "${day}"`);
  return Math.round(ms / DAY_MS);
}

export function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromDayNumber(toDayNumber(day) + n);
}

/** The UTC day containing this instant. */
export function dayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Start of the given UTC day as an instant. */
export function startOfDay(day: string): Date {
  return new Date(toDayNumber(day) * DAY_MS);
}
