import type { Company } from '../../lib/model/catalog.js';
import { addDays, dayOf } from '../../lib/model/dates.js';
import type { DataPoint, SourceId } from '../../lib/model/types.js';
import type { CollectorEnv } from './env.js';
import type { HttpClient } from './http.js';

export interface CollectContext {
  http: HttpClient;
  now: Date;
  env: CollectorEnv;
}

export interface CollectResult {
  source: SourceId;
  companyId: string;
  points: DataPoint[];
  /** What we tried to get and couldn't. Missing data stays missing. */
  missing: string[];
}

export type Collector = (company: Company, ctx: CollectContext) => Promise<CollectResult>;

/**
 * Daily counts: assume a day's number is published by the start of the day
 * after next, but never later than when we actually saw it.
 */
export function dailyAvailableAt(day: string, fetchedAt: Date): string {
  const assumed = Date.parse(`${addDays(day, 2)}T00:00:00Z`);
  return new Date(Math.min(assumed, fetchedAt.getTime())).toISOString();
}

/**
 * Last day whose count should be complete. Counters publish yesterday's total
 * during the UTC morning, so before noon UTC we stop at the day before yesterday.
 */
export function lastCompleteDay(now: Date): string {
  return addDays(dayOf(now), now.getUTCHours() >= 12 ? -1 : -2);
}

export function point(
  base: Pick<DataPoint, 'companyId' | 'metricId' | 'source' | 'value' | 'periodStart' | 'periodEnd' | 'availableAt' | 'sourceUrl'> & {
    note?: string;
  },
  fetchedAt: Date,
): DataPoint {
  return { ...base, fetchedAt: fetchedAt.toISOString(), provenance: 'scraped', simulated: false };
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
