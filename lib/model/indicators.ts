// Indicators panel data for the VC dashboard: one row per metric with value,
// source, as-of date and change vs four weeks earlier. Works with or without
// a market.

import { getCompany, metricsFor } from './catalog.js';
import { addDays, toDayNumber } from './dates.js';
import { buildDailySeries, windowTotal } from './series.js';
import { COMPARE_DAYS, SPONSOR_METRIC_LABELS, sponsorLabel, type SponsorMetricKind } from './sponsor.js';
import type { DataPoint, Provenance, SourceId } from './types.js';

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
  provenance: Provenance;
  provenanceLabel: string;
  simulated: boolean;
  missingReason?: string;
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
      provenance: 'sponsor_provided',
      provenanceLabel: 'Sponsor-provided',
      simulated: false,
    };
    if (!latest) {
      rows.push({ ...base, missingReason: 'Not provided by the sponsor' });
      continue;
    }
    rows.push({ ...base, value: latest.value, asOf: latest.periodEnd, provenanceLabel: sponsorLabel(latest), simulated: latest.simulated });
  }
  return rows;
}
