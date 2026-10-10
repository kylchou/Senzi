// Open job postings from public job-board APIs (Greenhouse Job Board API,
// Ashby posting API, Workable widget API). Current snapshot only: history
// builds up one point per collection day.

import type { JobBoard } from '../../lib/model/catalog.js';
import { metricIds } from '../../lib/model/catalog.js';
import { dayOf } from '../../lib/model/dates.js';
import { describeError, point, type Collector } from './common.js';

export function jobBoardUrl(b: JobBoard): string {
  switch (b.provider) {
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${b.board}/jobs`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${b.board}`;
    case 'workable':
      return `https://apply.workable.com/api/v1/widget/accounts/${b.board}`;
  }
}

export const collectJobs: Collector = async (company, ctx) => {
  if (!company.jobBoard) return { source: 'ashby', companyId: company.id, points: [], missing: ['No supported public job-board API verified; see the official careers page.'] };
  const url = jobBoardUrl(company.jobBoard);
  const source = company.jobBoard.provider;
  try {
    const body = await ctx.http.getJson<{ jobs?: Array<{ isListed?: boolean }> }>(url);
    if (!Array.isArray(body.jobs)) {
      return { source, companyId: company.id, points: [], missing: [`${source} board ${company.jobBoard.board}: no jobs list in response`] };
    }
    // Ashby includes unlisted postings with isListed=false.
    const count = body.jobs.filter((j) => j.isListed !== false).length;
    const today = dayOf(ctx.now);
    return {
      source,
      companyId: company.id,
      points: [
        point(
          {
            companyId: company.id,
            metricId: metricIds.openJobs,
            source,
            value: count,
            periodStart: today,
            periodEnd: today,
            availableAt: ctx.now.toISOString(),
            sourceUrl: url,
          },
          ctx.now,
        ),
      ],
      missing: [],
    };
  } catch (err) {
    return { source, companyId: company.id, points: [], missing: [`${source} board ${company.jobBoard.board}: ${describeError(err)}`] };
  }
};
