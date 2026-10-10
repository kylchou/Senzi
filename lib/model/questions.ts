// Threshold questions: wording and resolution.

import { getCompany, metricDef } from './catalog';
import { toDayNumber } from './dates';
import { buildDailySeries, windowTotal } from './series';
import type { DataPoint, SourceId, ThresholdQuestion } from './types';

const shortDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** 35000000 -> "35M", 5200000 -> "5.2M", 770 -> "770". */
function compact(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${+(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString('en-US');
}

/**
 * Short, but the window stays explicit: "Will Supabase's npm downloads reach
 * 35M in the 7 days ending Oct 25?" The package name and exact threshold live
 * in the market's criteria.
 */
export function questionText(companyId: string, metricId: string, threshold: number, windowEnd: string): string {
  const m = metricDef(companyId, metricId);
  const what = m.source === 'pypistats' ? 'PyPI downloads' : 'npm downloads';
  return `Will ${getCompany(companyId).name}'s ${what} reach ${compact(threshold)} in the 7 days ending ${shortDay(windowEnd)}?`;
}

const RESOLUTION: Partial<Record<SourceId, (metricId: string, windowEnd: string) => { url: string; description: string }>> = {
  npm: (metricId, end) => {
    const pkg = metricId.slice('npm_downloads:'.length);
    const start = new Date(Date.parse(`${end}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
    return {
      url: `https://api.npmjs.org/downloads/range/${start}:${end}/${pkg}`,
      description: 'Sum of daily downloads from the public npm downloads API for the 7-day window.',
    };
  },
  pypistats: (metricId) => {
    const pkg = metricId.slice('pypi_downloads:'.length);
    return {
      url: `https://pypistats.org/api/packages/${pkg}/overall?mirrors=false`,
      description: 'Sum of daily downloads (without mirrors) from pypistats.org for the 7-day window.',
    };
  },
};

export function makeQuestion(input: {
  id: string;
  companyId: string;
  metricId: string;
  threshold: number;
  windowEnd: string;
  opensAt: string;
  note?: string;
}): ThresholdQuestion {
  const m = metricDef(input.companyId, input.metricId);
  if (m.kind !== 'daily_count') throw new Error(`Threshold questions need a daily count metric, got ${m.kind}`);
  const resolver = RESOLUTION[m.source];
  if (!resolver) throw new Error(`No resolution source for ${m.source}`);
  toDayNumber(input.windowEnd);
  if (!Number.isFinite(input.threshold) || input.threshold < 0) throw new Error('Threshold must be >= 0');
  return {
    ...input,
    windowDays: 7,
    text: questionText(input.companyId, input.metricId, input.threshold, input.windowEnd),
    resolutionSource: { source: m.source, ...resolver(input.metricId, input.windowEnd) },
  };
}

export interface Resolution {
  questionId: string;
  status: 'resolved' | 'pending';
  outcome: 'YES' | 'NO' | null;
  observedTotal: number | null;
  /** Why the question is still pending (window not over, or data missing). */
  reason?: string;
}

/** Resolves from scraped data only. Sponsor-provided values never resolve a question. */
export function resolveQuestion(q: ThresholdQuestion, points: readonly DataPoint[], asOf: Date): Resolution {
  const series = buildDailySeries(points, q.metricId, asOf);
  const end = toDayNumber(q.windowEnd);
  if (series.lastDay === null || series.lastDay < end) {
    return { questionId: q.id, status: 'pending', outcome: null, observedTotal: null, reason: 'Window not fully reported yet' };
  }
  const total = windowTotal(series, end);
  if (total === null) {
    return { questionId: q.id, status: 'pending', outcome: null, observedTotal: null, reason: 'Days missing in the window' };
  }
  return { questionId: q.id, status: 'resolved', outcome: total >= q.threshold ? 'YES' : 'NO', observedTotal: total };
}
