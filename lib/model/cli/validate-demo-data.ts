// Validate staged or active scraped data; optional live identity checks are cached.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COMPANIES, metricsFor } from '../catalog.js';
import { buildDailySeries } from '../series.js';
import { FileModelStore, DEFAULT_DATA_DIR } from '../store.js';
import { lastCompleteDay } from '../../../scripts/scrapers/common.js';
import { loadEnv } from '../../../scripts/scrapers/env.js';
import { PoliteHttp } from '../../../scripts/scrapers/http.js';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = arg('data-dir') ? resolve(arg('data-dir')!) : DEFAULT_DATA_DIR;
const now = new Date();
const identitiesPath = join(dir, 'identity-report.json');

async function verifyIdentities() {
  const http = new PoliteHttp();
  const env = loadEnv();
  const identities: object[] = [];
  const npmRepos: Record<string, string[]> = {
    '@supabase/supabase-js': ['supabase/supabase-js'], vercel: ['vercel/vercel'], next: ['vercel/next.js'],
    stripe: ['stripe/stripe-node'], 'posthog-js': ['posthog/posthog-js'], resend: ['resend/resend-node'],
    convex: ['get-convex/convex-js', 'get-convex/convex-backend'],
    openai: ['openai/openai-node'], '@anthropic-ai/sdk': ['anthropics/anthropic-sdk-typescript'],
    '@sentry/node': ['getsentry/sentry-javascript'], '@clickhouse/client': ['clickhouse/clickhouse-js'],
    '@linear/sdk': ['linear/linear'], '@clerk/nextjs': ['clerk/javascript'],
    '@pinecone-database/pinecone': ['pinecone-io/pinecone-ts-client'], '@temporalio/client': ['temporalio/sdk-typescript'],
    '@planetscale/database': ['planetscale/database-js'], '@workos-inc/node': ['workos/workos-node'],
    inngest: ['inngest/inngest-js'], e2b: ['e2b-dev/e2b'], 'exa-js': ['exa-labs/exa-js'],
    langchain: ['langchain-ai/langchainjs'], llamaindex: ['run-llama/llamaindexts'],
    'cohere-ai': ['cohere-ai/cohere-typescript'], '@huggingface/transformers': ['huggingface/transformers.js'],
    '@elevenlabs/elevenlabs-js': ['elevenlabs/elevenlabs-js'], plaid: ['plaid/plaid-node'],
    'together-ai': ['togethercomputer/together-typescript'], '@browserbasehq/sdk': ['browserbase/sdk-node'],
    '@openrouter/ai-sdk-provider': ['openrouterteam/ai-sdk-provider'], '@mistralai/mistralai': ['mistralai/client-ts'],
    '@fal-ai/client': ['fal-ai/fal-js'],
  };
  // Packages whose npm metadata has no repository: verified by maintainer account instead.
  const npmMaintainers: Record<string, string[]> = { chromadb: ['jeff_chroma'] };
  const pythonRepos: Record<string, string> = { supabase: 'supabase/supabase-py', stripe: 'stripe/stripe-python',
    posthog: 'posthog/posthog-python', resend: 'resend/resend-python',
    openai: 'openai/openai-python', anthropic: 'anthropics/anthropic-sdk-python', 'sentry-sdk': 'getsentry/sentry-python',
    'clickhouse-connect': 'clickhouse/clickhouse-connect', 'clerk-backend-api': 'clerk/clerk-sdk-python',
    pinecone: 'pinecone-io/python-sdk', temporalio: 'temporalio/sdk-python',
    // workos lists only its own docs site, so the official domain is the identity check.
    workos: 'workos.com/docs/sdks/python', inngest: 'inngest/inngest-py', e2b: 'e2b-dev/e2b',
    langchain: 'langchain-ai/langchain', 'llama-index': 'run-llama/llama_index', chromadb: 'chroma-core/chroma',
    cohere: 'cohere-ai/cohere-python', 'huggingface-hub': 'huggingface/huggingface_hub', elevenlabs: 'elevenlabs/elevenlabs-python',
    'plaid-python': 'plaid/plaid-python', together: 'togethercomputer/together-py', browserbase: 'browserbase/sdk-python',
    mistralai: 'mistralai/client-python', 'fal-client': 'fal-ai/fal' };
  for (const c of COMPANIES) {
    for (const pkg of c.npmPackages) {
      const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`;
      const metadata = await http.getJson<{ name: string; repository?: { url?: string }; homepage?: string }>(url);
      const repository = metadata.repository?.url ?? '';
      let verified = (npmRepos[pkg] ?? []).some(repo => repository.toLowerCase().includes(repo));
      if (!verified && npmMaintainers[pkg]) {
        const full = await http.getJson<{ maintainers?: Array<{ name: string }> }>(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`);
        verified = (full.maintainers ?? []).some(m => npmMaintainers[pkg].includes(m.name));
      }
      if (metadata.name !== pkg || !verified) {
        throw new Error(`npm identity mismatch for ${pkg}: ${repository || 'no repository'}`);
      }
      identities.push({ companyId: c.id, kind: 'npm', package: pkg, repository, sourceUrl: url, checkedAt: now.toISOString() });
    }
    for (const pkg of c.pypiPackages) {
      const url = `https://pypi.org/pypi/${pkg}/json`;
      const metadata = await http.getJson<{ info: { name: string; project_urls: Record<string, string>; home_page?: string } }>(url);
      const links = Object.values(metadata.info.project_urls ?? {}).concat(metadata.info.home_page ?? '');
      if (metadata.info.name.toLowerCase().replaceAll('_', '-') !== pkg.replaceAll('_', '-') ||
          !links.some(link => link.toLowerCase().includes(pythonRepos[pkg] ?? '\u0000') ||
            (pkg === 'resend' && link.toLowerCase().includes('resendlabs/resend-python')))) throw new Error(`PyPI identity mismatch for ${pkg}: ${metadata.info.name}; ${links.join(', ')}`);
      identities.push({ companyId: c.id, kind: 'pypi', package: pkg, links, sourceUrl: url, checkedAt: now.toISOString() });
    }
    for (const repo of c.githubRepos) {
      const url = `https://api.github.com/repos/${repo}`;
      const metadata = await http.getJson<{ full_name: string; archived: boolean; html_url: string }>(url,
        { headers: env.githubToken ? { Authorization: `Bearer ${env.githubToken}` } : {} });
      if (metadata.full_name.toLowerCase() !== repo.toLowerCase() || metadata.archived) throw new Error(`GitHub identity mismatch or archived repository: ${repo}`);
      identities.push({ companyId: c.id, kind: 'github', repository: metadata.full_name, sourceUrl: metadata.html_url, checkedAt: now.toISOString() });
    }
    if (c.secCik && env.secUserAgent) {
      const url = `https://data.sec.gov/submissions/CIK${c.secCik.padStart(10, '0')}.json`;
      const metadata = await http.getJson<{ name: string; cik: number }>(url, { headers: { 'User-Agent': env.secUserAgent } });
      const names = c.id === 'vercel' ? ['vercel', 'zeit'] : [c.id];
      if (Number(c.secCik) !== Number(metadata.cik) || !names.some(name => metadata.name.toLowerCase().includes(name))) throw new Error(`SEC identity mismatch for ${c.id}: ${metadata.name} (CIK ${metadata.cik})`);
      identities.push({ companyId: c.id, kind: 'sec', cik: c.secCik, legalName: metadata.name, sourceUrl: url, checkedAt: now.toISOString() });
    }
  }
  writeFileSync(identitiesPath, JSON.stringify({ checkedAt: now.toISOString(), identities }, null, 2) + '\n');
  console.log(`Verified ${identities.length} package, repository and filer identities.`);
}

function validate() {
  const store = new FileModelStore(dir);
  const points = store.readPoints();
  const report = JSON.parse(readFileSync(join(dir, 'collection-report.json'), 'utf8'));
  const ids = COMPANIES.map(c => c.id).sort();
  if (JSON.stringify(Object.keys(report.companies).sort()) !== JSON.stringify(ids)) throw new Error('Collection report must contain exactly the catalog companies');
  const keys = new Set<string>();
  const allowed = new Map(COMPANIES.map(c => [c.id, new Set(metricsFor(c).map(m => m.id))]));
  const hosts: Record<string, string[]> = { npm: ['api.npmjs.org'], pypistats: ['pypistats.org'], github: ['api.github.com'],
    ashby: ['api.ashbyhq.com'], greenhouse: ['boards-api.greenhouse.io'], workable: ['apply.workable.com'], sec_edgar: ['www.sec.gov', 'data.sec.gov'],
    tranco: ['tranco-list.eu'], hn_algolia: ['hn.algolia.com'] };
  for (const p of points) {
    if (!allowed.get(p.companyId)?.has(p.metricId)) throw new Error(`Unexpected company/metric: ${p.companyId}/${p.metricId}`);
    if (!Number.isSafeInteger(p.value) || p.value < 0 || p.provenance !== 'scraped' || p.simulated) throw new Error(`Invalid value or provenance: ${p.metricId}`);
    if (![p.periodStart, p.periodEnd].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(d))) || p.periodStart > p.periodEnd) throw new Error('Invalid period');
    if (![p.availableAt, p.fetchedAt].every(d => Number.isFinite(Date.parse(d)) && Date.parse(d) <= now.getTime())) throw new Error('Invalid/future timestamp');
    if (Date.parse(p.availableAt) > Date.parse(p.fetchedAt) || Date.parse(p.periodEnd) > Date.parse(p.availableAt)) throw new Error('Impossible publication chronology');
    if (p.sourceUrl.startsWith('https://') === false || !hosts[p.source]?.includes(new URL(p.sourceUrl).hostname)) throw new Error(`Unexpected source: ${p.sourceUrl}`);
    const key = `${p.companyId}|${p.metricId}|${p.source}|${p.periodStart}|${p.periodEnd}`;
    if (keys.has(key)) throw new Error(`Duplicate point: ${key}`);
    keys.add(key);
  }
  const companies = COMPANIES.map(c => {
    if (report.companies[c.id].npm?.missing.length || report.companies[c.id].npm?.error) throw new Error(`Primary collection failed for ${c.id}`);
    // Companies can come from different collection runs (the expansion was collected separately).
    const collectedAt: string = report.companies[c.id].collectedAt ?? report.collectedAt;
    const latestDay = lastCompleteDay(new Date(collectedAt));
    const metric = c.questionMetricId;
    const daily = points.filter(p => p.companyId === c.id && p.metricId === metric).sort((a,b) => a.periodEnd.localeCompare(b.periodEnd));
    if (!daily.length || daily.at(-1)!.periodEnd !== latestDay) throw new Error(`Stale/missing primary history for ${c.id}; expected ${latestDay}`);
    for (let i = 1; i < daily.length; i++) if (Date.parse(daily[i].periodEnd) - Date.parse(daily[i-1].periodEnd) !== 86400000) throw new Error(`Missing calendar day for ${c.id}`);
    if (daily.some(p => p.fetchedAt !== collectedAt)) throw new Error(`Primary data not refreshed in this collection: ${c.id}`);
    const series = buildDailySeries(daily, metric, now);
    return { companyId: c.id, metric, points: daily.length, firstDay: daily[0].periodEnd, latestDay: daily.at(-1)!.periodEnd,
      fetchedAt: daily[0].fetchedAt, counterZerosExcludedByModel: series.zeroDaysTreatedAsMissing,
      sourceIssues: Object.entries(report.companies[c.id]).filter(([, v]) => typeof v === 'object' && v !== null &&
        ('error' in v || ('missing' in v && Array.isArray(v.missing) && v.missing.length))).map(([source, details]) => ({ source, details })) };
  });
  if (!existsSync(identitiesPath)) throw new Error('Live identity verification report missing; run --verify-identities first');
  writeFileSync(join(dir, 'validation-report.json'), JSON.stringify({ validatedAt: now.toISOString(), status: 'valid', totalPoints: points.length,
    latestCompleteDownloadDay: companies.reduce((max, c) => (c.latestDay > max ? c.latestDay : max), ''), companies, limitations: ['Downloads are public counter measurements, not users or revenue.',
      'npm zeros are retained verbatim and flagged as missing by the model; missing weeks are never imputed.',
      'HN values count keyword-matching stories, not verified company coverage.', 'Unavailable secondary sources remain missing.'] }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'valid', companies: ids.length, totalPoints: points.length }));
}

async function main() { if (process.argv.includes('--verify-identities')) await verifyIdentities(); validate(); }
main().catch(error => { console.error(error); process.exitCode = 1; });
