// Threshold questions: wording and resolution.

import { metricDef } from './catalog.js';
import { toDayNumber } from './dates.js';
import { buildDailySeries, windowTotal } from './series.js';
import type { DataPoint, SourceId, ThresholdQuestion } from './types.js';

const fmtDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Every question spells out its window, e.g. "in the 7 days ending November 8, 2026". */
export function questionText(companyId: string, metricId: string, threshold: number, windowEnd: string): string {
  const m = metricDef(companyId, metricId);
  return `Will ${m.label} in the 7 days ending ${fmtDay(windowEnd)} (UTC) be at least ${threshold.toLocaleString('en-US')}?`;
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
