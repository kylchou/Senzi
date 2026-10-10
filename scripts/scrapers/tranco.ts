// Tranco research ranking (https://tranco-list.eu), used as a traffic proxy.
// The API returns roughly the last 40 days of daily ranks. Lower is better.

import { metricIds } from '../../lib/model/catalog.js';
import type { DataPoint } from '../../lib/model/types.js';
import { dailyAvailableAt, describeError, point, type Collector } from './common.js';

export const collectTranco: Collector = async (company, ctx) => {
  const url = `https://tranco-list.eu/api/ranks/domain/${company.domain}`;
  try {
    const body = await ctx.http.getJson<{ ranks?: Array<{ date: string; rank: number }> }>(url);
    const points: DataPoint[] = (body.ranks ?? [])
      .filter((r) => Number.isFinite(r.rank))
      .map((r) =>
        point(
          {
            companyId: company.id,
            metricId: metricIds.trancoRank,
            source: 'tranco',
            value: r.rank,
            periodStart: r.date,
            periodEnd: r.date,
            availableAt: dailyAvailableAt(r.date, ctx.now),
            sourceUrl: url,
          },
          ctx.now,
        ),
      );
    return {
      source: 'tranco',
      companyId: company.id,
      points,
      missing: points.length ? [] : [`Tranco: ${company.domain} not ranked`],
    };
  } catch (err) {
    return { source: 'tranco', companyId: company.id, points: [], missing: [`Tranco ${company.domain}: ${describeError(err)}`] };
  }
};
