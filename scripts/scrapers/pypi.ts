// pypistats.org API (https://pypistats.org/api/). No auth; covers about the last
// 180 days only. "without_mirrors" excludes mirror traffic.

import { metricIds } from '../../lib/model/catalog.js';
import { toDayNumber } from '../../lib/model/dates.js';
import type { DataPoint } from '../../lib/model/types.js';
import { dailyAvailableAt, describeError, lastCompleteDay, point, type Collector } from './common.js';

interface PypiOverall {
  data: Array<{ category: string; date: string; downloads: number }>;
}

export const collectPypi: Collector = async (company, ctx) => {
  const points: DataPoint[] = [];
  const missing: string[] = [];
  const lastDay = toDayNumber(lastCompleteDay(ctx.now));
  for (const pkg of company.pypiPackages) {
    const url = `https://pypistats.org/api/packages/${pkg}/overall?mirrors=false`;
    try {
      const body = await ctx.http.getJson<PypiOverall>(url);
      for (const d of body.data ?? []) {
        if (d.category !== 'without_mirrors' || !Number.isFinite(d.downloads)) continue;
        if (toDayNumber(d.date) > lastDay) continue;
        points.push(
          point(
            {
              companyId: company.id,
              metricId: metricIds.pypi(pkg),
              source: 'pypistats',
              value: d.downloads,
              periodStart: d.date,
              periodEnd: d.date,
              availableAt: dailyAvailableAt(d.date, ctx.now),
              sourceUrl: url,
            },
            ctx.now,
          ),
        );
      }
    } catch (err) {
      missing.push(`PyPI ${pkg}: ${describeError(err)}`);
    }
  }
  return { source: 'pypistats', companyId: company.id, points, missing };
};
