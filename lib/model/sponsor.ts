// Sponsor-provided (VC-entered) metrics. Always labeled sponsor-provided, and
// labeled simulated when made up for the demo.
//
// They change a baseline only when they measure the question's own metric (see
// computeBaseline). ARR, MRR and user counts are display-only: shown on the
// dashboard and cross-checked against scraped growth for information. No rule
// yet decides what happens when they disagree.

import { addDays, toDayNumber } from './dates';
import { buildDailySeries, windowTotal } from './series';
import type { DataPoint } from './types';

export type SponsorMetricKind = 'arr' | 'mrr' | 'users';

export const SPONSOR_METRIC_LABELS: Record<SponsorMetricKind, { label: string; unit: string }> = {
  arr: { label: 'ARR', unit: 'USD' },
  mrr: { label: 'MRR', unit: 'USD' },
  users: { label: 'Users', unit: 'users' },
};

export const sponsorMetricId = (kind: SponsorMetricKind) => `sponsor_${kind}`;

export interface SponsorEntry {
  companyId: string;
  /** A sponsor KPI, or the id of a scraped metric the sponsor reports directly. */
  metric: SponsorMetricKind | { metricId: string };
  value: number;
  periodStart: string;
  periodEnd: string;
  /** When the sponsor entered it. */
  enteredAt: string;
  simulated: boolean;
  note?: string;
}

export function sponsorPoint(e: SponsorEntry): DataPoint {
  if (!Number.isFinite(e.value) || e.value < 0) throw new Error('Sponsor value must be a non-negative number');
  if (toDayNumber(e.periodEnd) < toDayNumber(e.periodStart)) throw new Error('periodEnd is before periodStart');
  if (Number.isNaN(Date.parse(e.enteredAt))) throw new Error('enteredAt must be an ISO timestamp');
  return {
    companyId: e.companyId,
    metricId: typeof e.metric === 'string' ? sponsorMetricId(e.metric) : e.metric.metricId,
    source: 'sponsor',
    value: e.value,
    periodStart: e.periodStart,
    periodEnd: e.periodEnd,
    availableAt: e.enteredAt,
    fetchedAt: e.enteredAt,
    sourceUrl: 'sponsor-entry',
    provenance: 'sponsor_provided',
    simulated: e.simulated,
    ...(e.note ? { note: e.note } : {}),
  };
}

export function sponsorLabel(p: Pick<DataPoint, 'simulated'>): string {
  return p.simulated ? 'Sponsor-provided (SIMULATED for the demo, not real company data)' : 'Sponsor-provided';
}

export interface SponsorCrossCheck {
  metricId: string;
  from: string;
  to: string;
  sponsorChange: number;
  scrapedMetricId: string;
  scrapedChange: number | null;
  note: string;
}

/**
 * Compares the change in each sponsor KPI with the change in a scraped metric
 * over the same dates (7-day totals ending on each date). Informational only.
 */
export function crossCheckSponsor(
  sponsorPoints: readonly DataPoint[],
  scrapedPoints: readonly DataPoint[],
  scrapedMetricId: string,
  asOf: Date,
): SponsorCrossCheck[] {
  const series = buildDailySeries(scrapedPoints, scrapedMetricId, asOf);
  const byMetric = new Map<string, DataPoint[]>();
  for (const p of sponsorPoints) {
    if (p.provenance !== 'sponsor_provided' || Date.parse(p.availableAt) > asOf.getTime()) continue;
    byMetric.set(p.metricId, [...(byMetric.get(p.metricId) ?? []), p]);
  }
  const out: SponsorCrossCheck[] = [];
  for (const [metricId, ps] of byMetric) {
    const sorted = [...ps].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    if (first === last || first.value === 0) continue;
    const a = windowTotal(series, toDayNumber(first.periodEnd));
    const b = windowTotal(series, toDayNumber(last.periodEnd));
    out.push({
      metricId,
      from: first.periodEnd,
      to: last.periodEnd,
      sponsorChange: last.value / first.value - 1,
      scrapedMetricId,
      scrapedChange: a && b !== null ? b / a - 1 : null,
      note:
        'Informational. These measure different things; a gap is a prompt to ask questions, not a contradiction. ' +
        'No rule yet decides what happens when they disagree.',
    });
  }
  return out;
}

/** Days before `day` used for "change vs 4 weeks ago" comparisons. */
export const COMPARE_DAYS = 28;
export const compareDay = (day: string) => addDays(day, -COMPARE_DAYS);
