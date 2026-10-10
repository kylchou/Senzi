// GitHub REST API. Uses GITHUB_TOKEN when set (5,000 requests/hour instead of 60).
// Collects the current star count (a snapshot; history accumulates across runs)
// and weekly commit counts for the last year.

import { metricIds } from '../../lib/model/catalog.js';
import { addDays, dayOf, toDayNumber } from '../../lib/model/dates.js';
import type { DataPoint } from '../../lib/model/types.js';
import { describeError, point, type Collector } from './common.js';

interface Repo {
  stargazers_count: number;
}
type CommitActivity = Array<{ week: number; total: number }>;

export const collectGithub: Collector = async (company, ctx) => {
  const points: DataPoint[] = [];
  const missing: string[] = [];
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(ctx.env.githubToken ? { Authorization: `Bearer ${ctx.env.githubToken}` } : {}),
  };
  const today = dayOf(ctx.now);
  const fetchedAt = ctx.now.toISOString();

  for (const repo of company.githubRepos) {
    const repoUrl = `https://api.github.com/repos/${repo}`;
    try {
      const r = await ctx.http.getJson<Repo>(repoUrl, { headers });
      points.push(
        point(
          {
            companyId: company.id,
            metricId: metricIds.githubStars(repo),
            source: 'github',
            value: r.stargazers_count,
            periodStart: today,
            periodEnd: today,
            availableAt: fetchedAt,
            sourceUrl: repoUrl,
          },
          ctx.now,
        ),
      );
    } catch (err) {
      missing.push(`GitHub stars ${repo}: ${describeError(err)}`);
    }

    const statsUrl = `https://api.github.com/repos/${repo}/stats/commit_activity`;
    try {
      const weeks = await ctx.http.getJson<CommitActivity>(statsUrl, { headers, retryOn202: true });
      for (const w of Array.isArray(weeks) ? weeks : []) {
        const start = new Date(w.week * 1000).toISOString().slice(0, 10);
        const end = addDays(start, 6);
        // The current week is still in progress; skip it.
        if (toDayNumber(end) >= toDayNumber(today)) continue;
        points.push(
          point(
            {
              companyId: company.id,
              metricId: metricIds.githubCommits(repo),
              source: 'github',
              value: w.total,
              periodStart: start,
              periodEnd: end,
              availableAt: new Date(Math.min(Date.parse(`${addDays(end, 1)}T00:00:00Z`), ctx.now.getTime())).toISOString(),
              sourceUrl: statsUrl,
            },
            ctx.now,
          ),
        );
      }
    } catch (err) {
      missing.push(`GitHub commit activity ${repo}: ${describeError(err)}`);
    }
  }
  return { source: 'github', companyId: company.id, points, missing };
};
