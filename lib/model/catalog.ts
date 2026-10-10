// Demo companies and the public identifiers we collect for each.
// Every identifier here was checked against the live source on 2026-10-09.

import type { MetricDef, SourceId } from './types';

export type JobBoard =
  | { provider: 'greenhouse'; board: string }
  | { provider: 'ashby'; board: string }
  | { provider: 'workable'; board: string };

export interface Company {
  id: string;
  name: string;
  domain: string;
  npmPackages: string[];
  pypiPackages: string[];
  githubRepos: string[];
  /** SEC CIK for Form D lookups. Null when no Form D filings were found. */
  secCik: string | null;
  /** Null when no supported public job-board API has been verified. */
  jobBoard: JobBoard | null;
  hnQuery: string;
  /** Metric used for demo threshold questions (also the resolution source). */
  questionMetricId: string;
}

export const COMPANIES: Company[] = [
  {
    id: 'supabase',
    name: 'Supabase',
    domain: 'supabase.com',
    npmPackages: ['@supabase/supabase-js'],
    pypiPackages: ['supabase'],
    githubRepos: ['supabase/supabase'],
    secCik: '0001829334',
    jobBoard: { provider: 'ashby', board: 'supabase' },
    hnQuery: 'supabase',
    questionMetricId: 'npm_downloads:@supabase/supabase-js',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    domain: 'vercel.com',
    npmPackages: ['vercel', 'next'],
    pypiPackages: [],
    githubRepos: ['vercel/next.js'],
    secCik: '0001893137',
    jobBoard: { provider: 'greenhouse', board: 'vercel' },
    hnQuery: 'vercel',
    questionMetricId: 'npm_downloads:vercel',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    domain: 'stripe.com',
    npmPackages: ['stripe'],
    pypiPackages: ['stripe'],
    githubRepos: ['stripe/stripe-node'],
    secCik: '0001691342',
    jobBoard: { provider: 'greenhouse', board: 'stripe' },
    hnQuery: 'stripe',
    questionMetricId: 'npm_downloads:stripe',
  },
  {
    id: 'resend',
    name: 'Resend',
    domain: 'resend.com',
    npmPackages: ['resend'],
    pypiPackages: ['resend'],
    githubRepos: ['resend/resend-node'],
    secCik: null,
    jobBoard: null, // Official careers page uses a custom site, not a verified supported board.
    hnQuery: 'resend',
    questionMetricId: 'npm_downloads:resend',
  },
  {
    id: 'convex',
    name: 'Convex',
    domain: 'convex.dev',
    npmPackages: ['convex'],
    pypiPackages: [],
    githubRepos: ['get-convex/convex-js'],
    secCik: null,
    jobBoard: { provider: 'ashby', board: 'convex-dev' },
    hnQuery: 'convex',
    questionMetricId: 'npm_downloads:convex',
  },
  {
    id: 'posthog',
    name: 'PostHog',
    domain: 'posthog.com',
    npmPackages: ['posthog-js'],
    pypiPackages: ['posthog'],
    githubRepos: ['PostHog/posthog'],
    secCik: null,
    jobBoard: { provider: 'ashby', board: 'posthog' },
    hnQuery: 'posthog',
    questionMetricId: 'npm_downloads:posthog-js',
  },
];

export function getCompany(id: string): Company {
  const c = COMPANIES.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown company "${id}"`);
  return c;
}

export const metricIds = {
  npm: (pkg: string) => `npm_downloads:${pkg}`,
  pypi: (pkg: string) => `pypi_downloads:${pkg}`,
  githubStars: (repo: string) => `github_stars:${repo}`,
  githubCommits: (repo: string) => `github_commits_weekly:${repo}`,
  openJobs: 'open_jobs',
  formDAmountSold: 'formd_amount_sold',
  formDOffering: 'formd_total_offering',
  trancoRank: 'tranco_rank',
  hnStories: 'hn_stories_weekly',
} as const;

/** Metric definitions for a company, used for labels and question text. */
export function metricsFor(c: Company): MetricDef[] {
  const def = (id: string, source: SourceId, label: string, unit: string, kind: MetricDef['kind'], higherIsBetter = true): MetricDef => ({
    id,
    companyId: c.id,
    source,
    label,
    unit,
    kind,
    higherIsBetter,
  });
  return [
    ...c.npmPackages.map((p) => def(metricIds.npm(p), 'npm', `npm downloads of ${p}`, 'downloads', 'daily_count')),
    ...c.pypiPackages.map((p) => def(metricIds.pypi(p), 'pypistats', `PyPI downloads of ${p}`, 'downloads', 'daily_count')),
    ...c.githubRepos.map((r) => def(metricIds.githubStars(r), 'github', `GitHub stars on ${r}`, 'stars', 'snapshot')),
    ...c.githubRepos.map((r) => def(metricIds.githubCommits(r), 'github', `Weekly commits to ${r}`, 'commits', 'weekly_count')),
    ...(c.jobBoard ? [def(metricIds.openJobs, c.jobBoard.provider, 'Open job postings', 'postings', 'snapshot')] : []),
    def(metricIds.formDAmountSold, 'sec_edgar', 'Form D amount sold', 'USD', 'event'),
    def(metricIds.formDOffering, 'sec_edgar', 'Form D total offering amount', 'USD', 'event'),
    def(metricIds.trancoRank, 'tranco', `Tranco rank of ${c.domain}`, 'rank', 'rank', false),
    def(metricIds.hnStories, 'hn_algolia', `Hacker News stories mentioning "${c.hnQuery}" (weekly)`, 'stories', 'weekly_count'),
  ];
}

export function metricDef(companyId: string, metricId: string): MetricDef {
  const m = metricsFor(getCompany(companyId)).find((x) => x.id === metricId);
  if (!m) throw new Error(`Unknown metric "${metricId}" for ${companyId}`);
  return m;
}
