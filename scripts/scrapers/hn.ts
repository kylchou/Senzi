// Hacker News stories mentioning the company per week, via the HN Algolia API
// (https://hn.algolia.com/api). A rough proxy for press and developer attention.
// Keyword matching is crude ("stripe" also matches unrelated stories).

import { metricIds } from '../../lib/model/catalog.js';
import { addDays, startOfDay } from '../../lib/model/dates.js';
import type { DataPoint } from '../../lib/model/types.js';
import { describeError, lastCompleteDay, point, type Collector } from './common.js';

export const HN_WEEKS = 26;

export const collectHn: Collector = async (company, ctx) => {
  const points: DataPoint[] = [];
  const missing: string[] = [];
  const lastEnd = lastCompleteDay(ctx.now);
  for (let k = HN_WEEKS - 1; k >= 0; k--) {
    const end = addDays(lastEnd, -7 * k);
    const start = addDays(end, -6);
    const from = startOfDay(start).getTime() / 1000;
    const to = startOfDay(addDays(end, 1)).getTime() / 1000;
    const url =
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(company.hnQuery)}&tags=story` +
      `&numericFilters=${encodeURIComponent(`created_at_i>=${from},created_at_i<${to}`)}&hitsPerPage=0`;
    try {
      const body = await ctx.http.getJson<{ nbHits: number }>(url);
      points.push(
        point(
          {
            companyId: company.id,
            metricId: metricIds.hnStories,
            source: 'hn_algolia',
            value: body.nbHits,
            periodStart: start,
            periodEnd: end,
            availableAt: `${addDays(end, 1)}T00:00:00.000Z`,
            sourceUrl: url,
          },
          ctx.now,
        ),
      );
    } catch (err) {
      missing.push(`HN week ending ${end}: ${describeError(err)}`);
    }
  }
  return { source: 'hn_algolia', companyId: company.id, points, missing };
};
