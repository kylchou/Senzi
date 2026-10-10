// Indicators panel data for the VC dashboard: one row per metric with value,
// source, as-of date and change vs four weeks earlier. Works with or without
// a market.

import { getCompany, metricsFor } from './catalog';
import { addDays, toDayNumber } from './dates';
import { buildDailySeries, windowTotal } from './series';
import { COMPARE_DAYS, SPONSOR_METRIC_LABELS, sponsorLabel, type SponsorMetricKind } from './sponsor';
import type { DataPoint, Provenance, SourceId } from './types';

export interface Indicator {
  metricId: string;
  label: string;
  unit: string;
  value: number | null;
  /** Period the value covers (last day). */
  asOf: string | null;
  /** Relative change vs the comparable value four weeks earlier. */
  change4w: number | null;
  source: SourceId;
  sourceUrl: string | null;
  /** When the latest value was fetched (scraped) or entered (sponsor). */
  fetchedAt: string | null;
  provenance: Provenance;
  provenanceLabel: string;
  simulated: boolean;
  missingReason?: string;
}

/** One scraped metric over time, for the company hub's indicator charts. */
export interface IndicatorHistory {
  metricId: string;
  label: string;
  unit: string;
  source: SourceId;
  sourceUrl: string | null;
  fetchedAt: string | null;
  higherIsBetter: boolean;
  /** Daily counts are summed into 7-day totals; other kinds are the observed values. */
  points: { date: string; value: number }[];
}

function visible(points: readonly DataPoint[], asOf: Date) {
  return points.filter((p) => Date.parse(p.availableAt) <= asOf.getTime());
}

function latestOf(points: readonly DataPoint[]): DataPoint | null {
  return points.reduce<DataPoint | null>(
    (m, p) => (!m || p.periodEnd > m.periodEnd || (p.periodEnd === m.periodEnd && p.fetchedAt > m.fetchedAt) ? p : m),
    null,
  );
}

export function getCompanyIndicators(
  companyId: string,
  scraped: readonly DataPoint[],
  sponsor: readonly DataPoint[],
  asOf: Date,
): Indicator[] {
  const company = getCompany(companyId);
  const pts = visible(scraped, asOf).filter((p) => p.companyId === companyId && p.provenance === 'scraped');
  const rows: Indicator[] = [];

  for (const m of metricsFor(company)) {
    const mine = pts.filter((p) => p.metricId === m.id);
    const row: Indicator = {
      metricId: m.id,
      label: m.label,
      unit: m.unit,
      value: null,
      asOf: null,
      change4w: null,
      source: m.source,
      sourceUrl: null,
      fetchedAt: null,
      provenance: 'scraped',
      provenanceLabel: 'Scraped from a public source',
      simulated: false,
    };
    if (!mine.length) {
      rows.push({ ...row, missingReason: 'No data collected for this metric' });
      continue;
    }
    const latest = latestOf(mine)!;
    row.sourceUrl = latest.sourceUrl;
    row.fetchedAt = latest.fetchedAt;

    if (m.kind === 'daily_count') {
      // Latest complete 7-day total, compared with the 7 days ending four weeks earlier.
      const series = buildDailySeries(mine, m.id, asOf);
      let end = series.lastDay;
      let total: number | null = null;
      while (end !== null && series.firstDay !== null && end - 6 >= series.firstDay && total === null) {
        total = windowTotal(series, end);
        if (total === null) end--;
      }
      if (total === null || end === null) {
        rows.push({ ...row, missingReason: 'No complete 7-day window' });
        continue;
      }
      const prior = windowTotal(series, end - COMPARE_DAYS);
      row.label = `${m.label} (7-day total)`;
      row.value = total;
      row.asOf = new Date(end * 86_400_000).toISOString().slice(0, 10);
      row.change4w = prior ? total / prior - 1 : null;
    } else {
      row.value = latest.value;
      row.asOf = latest.periodEnd;
      const target = toDayNumber(addDays(latest.periodEnd, -COMPARE_DAYS));
      const prior = mine
        .filter((p) => toDayNumber(p.periodEnd) <= target)
        .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
      if (prior && prior.value !== 0 && m.kind !== 'event') row.change4w = latest.value / prior.value - 1;
    }
    rows.push(row);
  }

  const sp = visible(sponsor, asOf).filter((p) => p.companyId === companyId && p.provenance === 'sponsor_provided');
  for (const kind of Object.keys(SPONSOR_METRIC_LABELS) as SponsorMetricKind[]) {
    const mine = sp.filter((p) => p.metricId === `sponsor_${kind}`);
    const latest = latestOf(mine);
    const meta = SPONSOR_METRIC_LABELS[kind];
    const base: Indicator = {
      metricId: `sponsor_${kind}`,
      label: meta.label,
      unit: meta.unit,
      value: null,
      asOf: null,
      change4w: null,
      source: 'sponsor',
      sourceUrl: null,
      fetchedAt: null,
      provenance: 'sponsor_provided',
      provenanceLabel: 'Sponsor-provided',
      simulated: false,
    };
    if (!latest) {
      rows.push({ ...base, missingReason: 'Not provided by the sponsor' });
      continue;
    }
    rows.push({ ...base, value: latest.value, asOf: latest.periodEnd, fetchedAt: latest.fetchedAt, provenanceLabel: sponsorLabel(latest), simulated: latest.simulated });
  }
  return rows;
}

/** Scraped metrics over time, oldest first. Metrics with no data are left out. */
export function getIndicatorHistory(companyId: string, scraped: readonly DataPoint[], asOf: Date): IndicatorHistory[] {
  const company = getCompany(companyId);
  const pts = visible(scraped, asOf).filter((p) => p.companyId === companyId && p.provenance === 'scraped');
  const out: IndicatorHistory[] = [];
  for (const m of metricsFor(company)) {
    const mine = pts.filter((p) => p.metricId === m.id);
    const latest = latestOf(mine);
    if (!latest) continue;
    let points: { date: string; value: number }[];
    if (m.kind === 'daily_count') {
      // Non-overlapping complete 7-day totals, stepping back from the latest day.
      const series = buildDailySeries(mine, m.id, asOf);
      points = [];
      for (let end = series.lastDay; end !== null && series.firstDay !== null && end - 6 >= series.firstDay; end -= 7) {
        const total = windowTotal(series, end);
        if (total !== null) points.push({ date: new Date(end * 86_400_000).toISOString().slice(0, 10), value: total });
      }
      points.reverse();
    } else {
      // One value per period end; a re-fetch of the same period replaces the older one.
      const byDay = new Map<string, DataPoint>();
      for (const p of mine) {
        const prev = byDay.get(p.periodEnd);
        if (!prev || prev.fetchedAt < p.fetchedAt) byDay.set(p.periodEnd, p);
      }
      points = [...byDay.values()].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).map((p) => ({ date: p.periodEnd, value: p.value }));
    }
    if (!points.length) continue;
    out.push({
      metricId: m.id,
      label: m.kind === 'daily_count' ? `${m.label} (7-day totals)` : m.label,
      unit: m.unit,
      source: m.source,
      sourceUrl: latest.sourceUrl,
      fetchedAt: latest.fetchedAt,
      higherIsBetter: m.higherIsBetter,
      points,
    });
  }
  return out;
}
