import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getCompany } from '@/lib/model/catalog.js';
import type { DataPoint } from '@/lib/model/types.js';
import { dailyAvailableAt, lastCompleteDay, type CollectContext } from '@/scripts/scrapers/common.js';
import { loadEnv, MissingEnvError } from '@/scripts/scrapers/env.js';
import { collectGithub } from '@/scripts/scrapers/github.js';
import { collectHn, HN_WEEKS } from '@/scripts/scrapers/hn.js';
import { HttpError, PoliteHttp } from '@/scripts/scrapers/http.js';
import { collectJobs, jobBoardUrl } from '@/scripts/scrapers/jobs.js';
import { mergePoints } from '@/scripts/scrapers/merge.js';
import { collectNpm, NPM_HISTORY_START, npmRanges } from '@/scripts/scrapers/npm.js';
import { collectPypi } from '@/scripts/scrapers/pypi.js';
import { collectFormD, xmlNumber } from '@/scripts/scrapers/sec-formd.js';
import { collectTranco } from '@/scripts/scrapers/tranco.js';

type Handler = (url: string, init: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> };

function fakeHttp(handler: Handler) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const sleeps: number[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, headers: { ...(init.headers as Record<string, string>) } });
    const r = handler(url, init);
    const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  const http = new PoliteHttp({ fetchImpl, sleep: async (ms) => void sleeps.push(ms), defaultIntervalMs: 0 });
  return { http, calls, sleeps };
}

const NOW = new Date('2026-10-09T15:00:00Z');
const ctxFor = (http: PoliteHttp, env: Partial<CollectContext['env']> = {}): CollectContext => ({
  http,
  now: NOW,
  env: { secUserAgent: null, githubToken: null, ...env },
});

describe('PoliteHttp', () => {
  it('retries 429 and 5xx with backoff, honouring Retry-After', async () => {
    let n = 0;
    const { http, sleeps } = fakeHttp(() => (++n === 1 ? { status: 429, headers: { 'retry-after': '3' } } : n === 2 ? { status: 503 } : { body: { ok: true } }));
    await expect(http.getJson('https://example.test/a')).resolves.toEqual({ ok: true });
    expect(n).toBe(3);
    expect(sleeps).toContain(3000);
    expect(sleeps).toContain(2000); // second backoff: 1000 * 2^1
  });

  it('does not retry client errors', async () => {
    let n = 0;
    const { http } = fakeHttp(() => (n++, { status: 404 }));
    await expect(http.getJson('https://example.test/missing')).rejects.toBeInstanceOf(HttpError);
    expect(n).toBe(1);
  });

  it('gives up after maxRetries', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 500 }));
    await expect(http.getText('https://example.test/x')).rejects.toThrow(/HTTP 500/);
    expect(calls).toHaveLength(5);
  });

  it('retries 202 only when asked', async () => {
    let n = 0;
    const { http } = fakeHttp(() => (++n < 3 ? { status: 202 } : { body: [1] }));
    await expect(http.getJson('https://example.test/stats', { retryOn202: true })).resolves.toEqual([1]);
    const { http: http2 } = fakeHttp(() => ({ status: 202, body: 'computing' }));
    await expect(http2.getText('https://example.test/stats')).resolves.toBe('computing');
  });

  it('spaces requests to the same host', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const http = new PoliteHttp({
      fetchImpl: (async () => new Response('{}')) as typeof fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      now: () => clock,
      hostIntervals: { 'a.test': 1000 },
    });
    await http.getJson('https://a.test/1');
    await http.getJson('https://a.test/2');
    await http.getJson('https://a.test/3');
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('rejects invalid JSON', async () => {
    const { http } = fakeHttp(() => ({ body: 'not json' }));
    await expect(http.getJson('https://example.test/j')).rejects.toThrow(/Invalid JSON/);
  });
});

describe('collector helpers', () => {
  it('never marks data available before it was fetched', () => {
    expect(dailyAvailableAt('2026-10-01', NOW)).toBe('2026-10-03T00:00:00.000Z');
    expect(dailyAvailableAt('2026-10-08', NOW)).toBe(NOW.toISOString());
  });

  it('stops at the last complete day', () => {
    expect(lastCompleteDay(new Date('2026-10-09T15:00:00Z'))).toBe('2026-10-08');
    expect(lastCompleteDay(new Date('2026-10-09T03:00:00Z'))).toBe('2026-10-07');
  });

  it('merges re-fetched points, newest wins, snapshots accumulate', () => {
    const p = (value: number, periodEnd: string, fetchedAt: string): DataPoint => ({
      companyId: 'c', metricId: 'm', source: 'npm', value, periodStart: periodEnd, periodEnd, availableAt: fetchedAt, fetchedAt, sourceUrl: 'u', provenance: 'scraped', simulated: false,
    });
    const merged = mergePoints([p(1, '2026-01-01', '2026-01-02'), p(5, '2026-01-02', '2026-01-03')], [p(2, '2026-01-01', '2026-01-05'), p(9, '2026-01-03', '2026-01-05')]);
    expect(merged.map((x) => [x.periodEnd, x.value])).toEqual([
      ['2026-01-01', 2],
      ['2026-01-02', 5],
      ['2026-01-03', 9],
    ]);
  });
});

describe('npm collector', () => {
  it('splits history into contiguous ranges of at most 540 days', () => {
    const r = npmRanges('2023-01-01', '2026-10-08');
    expect(r[0]![0]).toBe('2023-01-01');
    expect(r.at(-1)![1]).toBe('2026-10-08');
    for (let i = 1; i < r.length; i++) {
      expect(Date.parse(r[i]![0]) - Date.parse(r[i - 1]![1])).toBe(86_400_000);
    }
  });

  it('collects daily points for each package and range', async () => {
    const { http, calls } = fakeHttp((url) => {
      const m = url.match(/range\/([\d-]+):([\d-]+)\/(.+)$/)!;
      return { body: { package: m[3], downloads: [{ day: m[1], downloads: 10 }, { day: m[2], downloads: 20 }] } };
    });
    const r = await collectNpm(getCompany('vercel'), ctxFor(http));
    const ranges = npmRanges(NPM_HISTORY_START, '2026-10-08').length;
    expect(calls).toHaveLength(2 * ranges);
    expect(r.points).toHaveLength(4 * ranges);
    expect(new Set(r.points.map((p) => p.metricId))).toEqual(new Set(['npm_downloads:vercel', 'npm_downloads:next']));
    expect(r.points.every((p) => p.provenance === 'scraped' && !p.simulated && p.availableAt <= NOW.toISOString())).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('records failures as missing instead of inventing data', async () => {
    const { http } = fakeHttp(() => ({ status: 404, body: { error: 'package not found' } }));
    const r = await collectNpm(getCompany('posthog'), ctxFor(http));
    expect(r.points).toEqual([]);
    expect(r.missing[0]).toMatch(/npm posthog-js .*HTTP 404/);
  });
});

describe('PyPI collector', () => {
  it('keeps only without_mirrors rows up to the last complete day', async () => {
    const { http } = fakeHttp(() => ({
      body: {
        data: [
          { category: 'with_mirrors', date: '2026-10-01', downloads: 999 },
          { category: 'without_mirrors', date: '2026-10-01', downloads: 100 },
          { category: 'without_mirrors', date: '2026-10-09', downloads: 5 },
        ],
      },
    }));
    const r = await collectPypi(getCompany('databricks'), ctxFor(http));
    expect(r.points.map((p) => [p.metricId, p.periodEnd, p.value])).toEqual([['pypi_downloads:databricks-sdk', '2026-10-01', 100]]);
  });
});

describe('GitHub collector', () => {
  const handler: Handler = (url) =>
    url.endsWith('commit_activity')
      ? {
          body: [
            { week: Date.parse('2026-09-20T00:00:00Z') / 1000, total: 40 },
            { week: Date.parse('2026-10-04T00:00:00Z') / 1000, total: 7 },
          ],
        }
      : { body: { stargazers_count: 1234 } };

  it('sends the token only when configured', async () => {
    const a = fakeHttp(handler);
    await collectGithub(getCompany('posthog'), ctxFor(a.http, { githubToken: 'tok' }));
    expect(a.calls.every((c) => c.headers.Authorization === 'Bearer tok')).toBe(true);
    const b = fakeHttp(handler);
    await collectGithub(getCompany('posthog'), ctxFor(b.http));
    expect(b.calls.every((c) => !('Authorization' in c.headers))).toBe(true);
  });

  it('records stars as a snapshot and skips the in-progress commit week', async () => {
    const { http } = fakeHttp(handler);
    const r = await collectGithub(getCompany('posthog'), ctxFor(http));
    const stars = r.points.find((p) => p.metricId.startsWith('github_stars'))!;
    expect(stars).toMatchObject({ value: 1234, periodEnd: '2026-10-09', availableAt: NOW.toISOString() });
    const commits = r.points.filter((p) => p.metricId.startsWith('github_commits'));
    expect(commits.map((p) => [p.periodStart, p.periodEnd, p.value])).toEqual([['2026-09-20', '2026-09-26', 40]]);
  });

  it('reports stats that never finish computing as missing', async () => {
    const { http } = fakeHttp((url) => (url.endsWith('commit_activity') ? { status: 202 } : { body: { stargazers_count: 1 } }));
    const r = await collectGithub(getCompany('posthog'), ctxFor(http));
    expect(r.missing[0]).toMatch(/commit activity.*Still computing/);
  });
});

describe('SEC Form D collector', () => {
  const formD = (sold: string, offering: string) =>
    `<edgarSubmission><offeringData><offeringSalesAmounts><totalOfferingAmount>${offering}</totalOfferingAmount><totalAmountSold>${sold}</totalAmountSold></offeringSalesAmounts></offeringData><relatedPersonsList><relatedPersonInfo><relatedPersonName><firstName>Private</firstName></relatedPersonName></relatedPersonInfo></relatedPersonsList></edgarSubmission>`;
  const handler: Handler = (url) => {
    if (url.includes('submissions')) {
      return {
        body: {
          name: 'Supabase, Inc.',
          filings: {
            recent: {
              form: ['10-K', 'D', 'D/A'],
              filingDate: ['2026-09-01', '2026-06-05', '2026-02-09'],
              accessionNumber: ['0000-26-9', '0001829334-26-000002', '0001829334-26-000001'],
            },
          },
        },
      };
    }
    return { body: url.includes('26000002') ? formD('100000000', '120000000') : formD('5,000,000', 'Indefinite') };
  };

  it('refuses to run without SEC_USER_AGENT', async () => {
    const { http, calls } = fakeHttp(handler);
    await expect(collectFormD(getCompany('supabase'), ctxFor(http))).rejects.toBeInstanceOf(MissingEnvError);
    expect(calls).toHaveLength(0);
  });

  it('sends the declared User-Agent and keeps only amounts and dates', async () => {
    const { http, calls } = fakeHttp(handler);
    const r = await collectFormD(getCompany('supabase'), ctxFor(http, { secUserAgent: 'Team research@example.org' }));
    expect(calls.every((c) => c.headers['User-Agent'] === 'Team research@example.org')).toBe(true);
    expect(calls[1]!.url).toBe('https://www.sec.gov/Archives/edgar/data/1829334/000182933426000002/primary_doc.xml');
    expect(r.points.map((p) => [p.metricId, p.periodEnd, p.value])).toEqual([
      ['formd_amount_sold', '2026-06-05', 100_000_000],
      ['formd_total_offering', '2026-06-05', 120_000_000],
      ['formd_amount_sold', '2026-02-09', 5_000_000],
    ]);
    expect(r.missing.join(' ')).toMatch(/not numeric/);
    expect(JSON.stringify(r.points)).not.toMatch(/Private/);
    expect(r.points.every((p) => p.availableAt > `${p.periodEnd}T`)).toBe(true);
  });

  it('reports companies with no Form D filer as missing without any requests', async () => {
    const { http, calls } = fakeHttp(handler);
    const r = await collectFormD(getCompany('posthog'), ctxFor(http, { secUserAgent: 'x y@z.org' }));
    expect(r.points).toEqual([]);
    expect(r.missing[0]).toMatch(/No Form D filer/);
    expect(calls).toHaveLength(0);
  });

  it('parses numbers defensively', () => {
    expect(xmlNumber('<a>1,234</a>', 'a')).toBe(1234);
    expect(xmlNumber('<a>Indefinite</a>', 'a')).toBeNull();
    expect(xmlNumber('<a></a>', 'a')).toBeNull();
    expect(xmlNumber('<b>1</b>', 'a')).toBeNull();
  });
});

describe('jobs, Tranco and HN collectors', () => {
  it('counts listed jobs per provider', async () => {
    expect(jobBoardUrl({ provider: 'workable', board: 'huggingface' })).toBe('https://apply.workable.com/api/v1/widget/accounts/huggingface');
    const { http } = fakeHttp(() => ({ body: { jobs: [{}, { isListed: true }, { isListed: false }] } }));
    const r = await collectJobs(getCompany('supabase'), ctxFor(http));
    expect(r).toMatchObject({ source: 'ashby', missing: [] });
    expect(r.points[0]).toMatchObject({ metricId: 'open_jobs', value: 2, periodEnd: '2026-10-09' });
  });

  it('reports a missing job board instead of recording zero jobs', async () => {
    const { http } = fakeHttp(() => ({ status: 404 }));
    const r = await collectJobs(getCompany('stripe'), ctxFor(http));
    expect(r.points).toEqual([]);
    expect(r.missing[0]).toMatch(/greenhouse board stripe: HTTP 404/);
  });

  it('collects Tranco ranks', async () => {
    const { http } = fakeHttp(() => ({ body: { ranks: [{ date: '2026-10-08', rank: 240 }, { date: '2026-10-07', rank: 239 }] } }));
    const r = await collectTranco(getCompany('stripe'), ctxFor(http));
    expect(r.points.map((p) => [p.periodEnd, p.value])).toEqual([
      ['2026-10-08', 240],
      ['2026-10-07', 239],
    ]);
    const { http: empty } = fakeHttp(() => ({ body: { ranks: [] } }));
    expect((await collectTranco(getCompany('stripe'), ctxFor(empty))).missing[0]).toMatch(/not ranked/);
  });

  it('collects weekly HN story counts with non-overlapping windows', async () => {
    const { http, calls } = fakeHttp(() => ({ body: { nbHits: 3 } }));
    const r = await collectHn(getCompany('posthog'), ctxFor(http));
    expect(calls).toHaveLength(HN_WEEKS);
    expect(r.points).toHaveLength(HN_WEEKS);
    expect(r.points.at(-1)).toMatchObject({ periodStart: '2026-10-02', periodEnd: '2026-10-08', value: 3 });
    for (let i = 1; i < r.points.length; i++) {
      expect(Date.parse(r.points[i]!.periodStart) - Date.parse(r.points[i - 1]!.periodEnd)).toBe(86_400_000);
    }
    expect(decodeURIComponent(calls[0]!.url)).toMatch(/created_at_i>=\d+,created_at_i<\d+/);
  });
});

describe('loadEnv', () => {
  const saved = { sec: process.env.SEC_USER_AGENT, gh: process.env.GITHUB_TOKEN };
  afterEach(() => {
    for (const [k, v] of [['SEC_USER_AGENT', saved.sec], ['GITHUB_TOKEN', saved.gh]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('reads the .env file, treats blanks and a missing file as unset, and never overrides the shell', () => {
    const dir = mkdtempSync(join(tmpdir(), 'senzi-env-'));
    try {
      const file = join(dir, '.env');
      writeFileSync(file, 'SEC_USER_AGENT="Team a@example.org"\nGITHUB_TOKEN=\n');
      delete process.env.SEC_USER_AGENT;
      delete process.env.GITHUB_TOKEN;
      expect(loadEnv(file)).toEqual({ secUserAgent: 'Team a@example.org', githubToken: null });

      process.env.SEC_USER_AGENT = 'Shell b@example.org';
      expect(loadEnv(file).secUserAgent).toBe('Shell b@example.org');

      delete process.env.SEC_USER_AGENT;
      expect(loadEnv(join(dir, 'missing.env'))).toEqual({ secUserAgent: null, githubToken: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
