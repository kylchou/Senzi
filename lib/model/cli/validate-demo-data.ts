// Validate staged or active scraped data; optional live identity checks are cached.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COMPANIES, metricIds, metricsFor, NPM_INDEX_ID, NPM_INDEX_PACKAGES } from '../catalog.js';
import { buildDailySeries } from '../series.js';
import { FileModelStore, DEFAULT_DATA_DIR } from '../store.js';
import { lastCompleteDay } from '../../../scripts/scrapers/common.js';
import { loadEnv } from '../../../scripts/scrapers/env.js';
import { PoliteHttp } from '../../../scripts/scrapers/http.js';

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const dir = arg('data-dir') ? resolve(arg('data-dir')!) : DEFAULT_DATA_DIR;
const now = new Date();
const latestDay = lastCompleteDay(now);
const identitiesPath = join(dir, 'identity-report.json');

async function verifyIdentities() {
  const http = new PoliteHttp();
  const env = loadEnv();
  const identities: object[] = [];
  const npmRepos: Record<string, string[]> = {
    '@supabase/supabase-js': ['supabase/supabase-js'], vercel: ['vercel/vercel'], next: ['vercel/next.js'],
    stripe: ['stripe/stripe-node'], 'posthog-js': ['posthog/posthog-js'], resend: ['resend/resend-node'],
    convex: ['get-convex/convex-js', 'get-convex/convex-backend'],
  };
  const pythonRepos: Record<string, string> = { supabase: 'supabase/supabase-py', stripe: 'stripe/stripe-python',
    posthog: 'posthog/posthog-python', resend: 'resend/resend-python' };
  for (const c of COMPANIES) {
    for (const pkg of c.npmPackages) {
      const url = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`;
      const metadata = await http.getJson<{ name: string; repository?: { url?: string }; homepage?: string }>(url);
      const repository = metadata.repository?.url ?? '';
      if (metadata.name !== pkg || !npmRepos[pkg].some(repo => repository.toLowerCase().includes(repo))) {
        throw new Error(`npm identity mismatch for ${pkg}: ${repository}`);
      }
      identities.push({ companyId: c.id, kind: 'npm', package: pkg, repository, sourceUrl: url, checkedAt: now.toISOString() });
    }
    for (const pkg of c.pypiPackages) {
      const url = `https://pypi.org/pypi/${pkg}/json`;
      const metadata = await http.getJson<{ info: { name: string; project_urls: Record<string, string>; home_page?: string } }>(url);
      const links = Object.values(metadata.info.project_urls ?? {}).concat(metadata.info.home_page ?? '');
      if (metadata.info.name.toLowerCase().replaceAll('_', '-') !== pkg.replaceAll('_', '-') ||
          !links.some(link => link.toLowerCase().includes(pythonRepos[pkg]) ||
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
  if (JSON.stringify(Object.keys(report.companies).sort()) !== JSON.stringify(ids)) throw new Error('Collection report must contain exactly the selected six companies');
  const keys = new Set<string>();
  const allowed = new Map(COMPANIES.map(c => [c.id, new Set(metricsFor(c).map(m => m.id))]));
  const hosts: Record<string, string[]> = { npm: ['api.npmjs.org'], pypistats: ['pypistats.org'], github: ['api.github.com'],
    ashby: ['api.ashbyhq.com'], greenhouse: ['boards-api.greenhouse.io'], sec_edgar: ['www.sec.gov', 'data.sec.gov'],
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
    const metric = c.questionMetricId;
    const daily = points.filter(p => p.companyId === c.id && p.metricId === metric).sort((a,b) => a.periodEnd.localeCompare(b.periodEnd));
    if (!daily.length || daily.at(-1)!.periodEnd !== latestDay) throw new Error(`Stale/missing primary history for ${c.id}; expected ${latestDay}`);
    for (let i = 1; i < daily.length; i++) if (Date.parse(daily[i].periodEnd) - Date.parse(daily[i-1].periodEnd) !== 86400000) throw new Error(`Missing calendar day for ${c.id}`);
    if (daily.some(p => p.fetchedAt !== report.collectedAt)) throw new Error(`Primary data not refreshed in this collection: ${c.id}`);
    const series = buildDailySeries(daily, metric, now);
    return { companyId: c.id, metric, points: daily.length, firstDay: daily[0].periodEnd, latestDay: daily.at(-1)!.periodEnd,
      fetchedAt: daily[0].fetchedAt, counterZerosExcludedByModel: series.zeroDaysTreatedAsMissing,
      sourceIssues: Object.entries(report.companies[c.id]).filter(([, v]) => typeof v === 'object' && v !== null &&
        ('error' in v || ('missing' in v && Array.isArray(v.missing) && v.missing.length))).map(([source, details]) => ({ source, details })) };
  });
  const npmIndex = validateNpmIndex(store.readNpmIndexPoints());
  if (!existsSync(identitiesPath)) throw new Error('Live identity verification report missing; run --verify-identities first');
  writeFileSync(join(dir, 'validation-report.json'), JSON.stringify({ validatedAt: now.toISOString(), status: 'valid', totalPoints: points.length,
    latestCompleteDownloadDay: latestDay, companies, npmIndex, limitations: ['Downloads are public counter measurements, not users or revenue.',
      'npm zeros are retained verbatim and flagged as missing by the model; missing weeks are never imputed.',
      'HN values count keyword-matching stories, not verified company coverage.', 'Unavailable secondary sources remain missing.'] }, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'valid', companies: ids, totalPoints: points.length, latestCompleteDownloadDay: latestDay }));
}

/** The npm index basket (npm-index.jsonl) is optional; when present it must be complete and current. */
function validateNpmIndex(points: ReturnType<FileModelStore['readNpmIndexPoints']>) {
  if (!points.length) return { status: 'missing', note: 'npm questions fall back to raw downloads.' };
  const allowed = new Set(NPM_INDEX_PACKAGES.map(p => metricIds.npm(p)));
  const keys = new Set<string>();
  for (const p of points) {
    if (p.companyId !== NPM_INDEX_ID || !allowed.has(p.metricId) || p.source !== 'npm') throw new Error(`Unexpected npm index point: ${p.companyId}/${p.metricId}`);
    if (!Number.isSafeInteger(p.value) || p.value < 0 || p.provenance !== 'scraped' || p.simulated) throw new Error(`Invalid npm index value: ${p.metricId}`);
    if (new URL(p.sourceUrl).hostname !== 'api.npmjs.org') throw new Error(`Unexpected source: ${p.sourceUrl}`);
    if (Date.parse(p.availableAt) > Date.parse(p.fetchedAt) || Date.parse(p.periodEnd) > Date.parse(p.availableAt)) throw new Error('Impossible publication chronology');
    const key = `${p.metricId}|${p.periodEnd}`;
    if (keys.has(key)) throw new Error(`Duplicate npm index point: ${key}`);
    keys.add(key);
  }
  const packages = [...allowed].map(metric => {
    const daily = points.filter(p => p.metricId === metric).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
    if (!daily.length || daily.at(-1)!.periodEnd < latestDay) throw new Error(`Stale/missing npm index history for ${metric}; expected ${latestDay}`);
    for (let i = 1; i < daily.length; i++) if (Date.parse(daily[i].periodEnd) - Date.parse(daily[i-1].periodEnd) !== 86400000) throw new Error(`Missing calendar day for ${metric}`);
    return { metric, points: daily.length, firstDay: daily[0].periodEnd, latestDay: daily.at(-1)!.periodEnd,
      counterZerosExcludedByModel: buildDailySeries(daily, metric, now).zeroDaysTreatedAsMissing.length };
  });
  return { status: 'valid', packages };
}

async function main() { if (process.argv.includes('--verify-identities')) await verifyIdentities(); validate(); }
main().catch(error => { console.error(error); process.exitCode = 1; });
