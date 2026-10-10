// Collects public data for the demo companies into data/model/points/.
//
//   npx tsx scripts/scrapers/run.ts                          all companies, all sources
//   npx tsx scripts/scrapers/run.ts --company=supabase       one company
//   npx tsx scripts/scrapers/run.ts --only=npm,pypi          some sources
//
// Writes data/model/collection-report.json with counts, missing data and errors.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { COMPANIES } from '../../lib/model/catalog.js';
import { DEFAULT_DATA_DIR, FileModelStore } from '../../lib/model/store.js';
import { describeError, type CollectContext, type Collector } from './common.js';
import { loadEnv } from './env.js';
import { collectGithub } from './github.js';
import { collectHn } from './hn.js';
import { PoliteHttp } from './http.js';
import { collectJobs } from './jobs.js';
import { mergePoints } from './merge.js';
import { collectNpm } from './npm.js';
import { collectPypi } from './pypi.js';
import { collectFormD } from './sec-formd.js';
import { collectTranco } from './tranco.js';

export const COLLECTORS: Record<string, Collector> = {
  npm: collectNpm,
  pypi: collectPypi,
  github: collectGithub,
  sec: collectFormD,
  jobs: collectJobs,
  tranco: collectTranco,
  hn: collectHn,
};

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function main() {
  const env = loadEnv();
  const only = arg('only')?.split(',');
  const companyFilter = arg('company');
  const companies = COMPANIES.filter((c) => !companyFilter || c.id === companyFilter);
  const collectors = Object.entries(COLLECTORS).filter(([name]) => !only || only.includes(name));
  const http = new PoliteHttp();
  const ctx: CollectContext = { http, now: new Date(), env };
  const dataDir = arg('data-dir') ? resolve(arg('data-dir')!) : DEFAULT_DATA_DIR;
  const store = new FileModelStore(dataDir);

  if (!env.githubToken) console.warn('GITHUB_TOKEN not set: GitHub allows 60 requests/hour unauthenticated.');

  const report: Record<string, unknown> = { collectedAt: ctx.now.toISOString(), companies: {} as Record<string, unknown> };
  for (const company of companies) {
    const companyReport: Record<string, unknown> = {};
    const collected = [];
    for (const [name, collect] of collectors) {
      const started = Date.now();
      try {
        const r = await collect(company, ctx);
        collected.push(...r.points);
        companyReport[name] = { points: r.points.length, missing: r.missing, ms: Date.now() - started };
        console.log(`${company.id.padEnd(12)} ${name.padEnd(7)} ${String(r.points.length).padStart(5)} points${r.missing.length ? `, ${r.missing.length} missing` : ''}`);
      } catch (err) {
        companyReport[name] = { points: 0, error: describeError(err) };
        console.error(`${company.id.padEnd(12)} ${name.padEnd(7)} ERROR ${describeError(err)}`);
      }
    }
    const merged = mergePoints(store.readPoints(company.id), collected);
    store.writePoints(company.id, merged);
    (report.companies as Record<string, unknown>)[company.id] = { ...companyReport, storedPoints: merged.length };
  }
  report.requests = http.requests;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'collection-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Done: ${http.requests} requests.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
