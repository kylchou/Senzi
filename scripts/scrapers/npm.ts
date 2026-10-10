// npm public downloads API (https://github.com/npm/registry/blob/main/docs/download-counts.md).
// No auth. A single range request covers at most 18 months, so longer history
// is fetched as consecutive chunks.

import { metricIds, NPM_INDEX_ID, NPM_INDEX_PACKAGES } from '../../lib/model/catalog.js';
import { addDays, toDayNumber } from '../../lib/model/dates.js';
import type { DataPoint } from '../../lib/model/types.js';
import { dailyAvailableAt, describeError, lastCompleteDay, point, type CollectContext, type CollectResult, type Collector } from './common.js';

export const NPM_HISTORY_START = '2023-01-01';
const MAX_RANGE_DAYS = 540;

export function npmRanges(from: string, to: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let start = from; toDayNumber(start) <= toDayNumber(to); start = addDays(start, MAX_RANGE_DAYS)) {
    const end = addDays(start, MAX_RANGE_DAYS - 1);
    out.push([start, toDayNumber(end) > toDayNumber(to) ? to : end]);
  }
  return out;
}

interface NpmRange {
  package: string;
  downloads: Array<{ day: string; downloads: number }>;
}

/** Daily downloads for each package, stored under `companyId`. */
export async function collectNpmPackages(companyId: string, packages: readonly string[], ctx: CollectContext): Promise<CollectResult> {
  const points: DataPoint[] = [];
  const missing: string[] = [];
  const to = lastCompleteDay(ctx.now);
  for (const pkg of packages) {
    for (const [start, end] of npmRanges(NPM_HISTORY_START, to)) {
      const url = `https://api.npmjs.org/downloads/range/${start}:${end}/${pkg}`;
      try {
        const body = await ctx.http.getJson<NpmRange>(url);
        for (const d of body.downloads ?? []) {
          if (!Number.isFinite(d.downloads)) continue;
          points.push(
            point(
              {
                companyId,
                metricId: metricIds.npm(pkg),
                source: 'npm',
                value: d.downloads,
                periodStart: d.day,
                periodEnd: d.day,
                availableAt: dailyAvailableAt(d.day, ctx.now),
                sourceUrl: url,
              },
              ctx.now,
            ),
          );
        }
      } catch (err) {
        missing.push(`npm ${pkg} ${start}..${end}: ${describeError(err)}`);
      }
    }
  }
  return { source: 'npm', companyId, points, missing };
}

export const collectNpm: Collector = (company, ctx) => collectNpmPackages(company.id, company.npmPackages, ctx);

/** The npm-wide index basket (catalog.NPM_INDEX_PACKAGES). */
export const collectNpmIndex = (ctx: CollectContext) => collectNpmPackages(NPM_INDEX_ID, NPM_INDEX_PACKAGES, ctx);
