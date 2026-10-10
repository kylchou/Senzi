import type { DataPoint } from '../../lib/model/types.js';

const key = (p: DataPoint) => `${p.companyId}|${p.metricId}|${p.source}|${p.periodStart}|${p.periodEnd}`;

/**
 * Merges newly collected points into stored ones. For the same metric and
 * period the most recently fetched value wins (re-fetched daily counts replace
 * old copies); everything else is kept, so snapshot history accumulates.
 * Output is sorted for stable, diff-friendly files.
 */
export function mergePoints(existing: readonly DataPoint[], incoming: readonly DataPoint[]): DataPoint[] {
  const byKey = new Map<string, DataPoint>();
  for (const p of [...existing, ...incoming]) {
    const prev = byKey.get(key(p));
    if (!prev || prev.fetchedAt <= p.fetchedAt) byKey.set(key(p), p);
  }
  return [...byKey.values()].sort(
    (a, b) => a.metricId.localeCompare(b.metricId) || a.periodEnd.localeCompare(b.periodEnd) || a.source.localeCompare(b.source),
  );
}
