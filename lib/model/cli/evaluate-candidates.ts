// Isolated research run: never changes the production catalog, settings or baselines.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBaseline } from '../baseline.js';
import { buildCases, calibrationTable, caseMu, caseProbability, expectedCalibrationError, medianApe, PERSISTENCE, rangeCoverage, score, uniqueFits, type BacktestCase, type TunedSettings } from '../backtest.js';
import { addDays, toDayNumber } from '../dates.js';
import { defaultParams } from '../params.js';
import { seededRandom } from '../math.js';
import { buildDailySeries, windowTotal } from '../series.js';
import { FileModelStore } from '../store.js';
import type { DataPoint, ThresholdQuestion } from '../types.js';

const START = '2026-04-08';
const END = '2026-10-08';
const AS_OF = '2026-10-10T00:00:00.000Z'; // October 9, 8 pm Eastern.
const TEST_START = '2026-07-01';
const DIR = join(process.cwd(), 'data/model/candidate-evaluation');
const RAW = join(DIR, 'points.json');
const shipped: TunedSettings = { ...defaultParams };
const persistence: TunedSettings = { ...shipped, ...PERSISTENCE };
const referencePath = join(DIR, 'reference-settings.json');
const prior = JSON.parse(readFileSync(existsSync(referencePath) ? referencePath : 'data/model/backtest/results.json', 'utf8').replace(/^\uFEFF/, ''));
if (!existsSync(referencePath)) writeFileSync(referencePath, JSON.stringify({ tunedOnCalibration: prior.tunedOnCalibration }, null, 2));
const calibratedModel: TunedSettings = prior.tunedOnCalibration.trend;
const calibratedPersistence: TunedSettings = prior.tunedOnCalibration.persistence;

const primary = [
  { company: 'supabase', package: '@supabase/supabase-js', source: 'npm', group: 'existing' },
  { company: 'vercel', package: 'vercel', source: 'npm', group: 'existing' },
  { company: 'stripe', package: 'stripe', source: 'npm', group: 'existing' },
  { company: 'databricks', package: 'databricks-sdk', source: 'pypistats', group: 'existing' },
  { company: 'huggingface', package: 'huggingface_hub', source: 'pypistats', group: 'existing' },
  { company: 'posthog', package: 'posthog-js', source: 'npm', group: 'existing' },
  { company: 'modal', package: 'modal', source: 'pypistats', group: 'new' },
  { company: 'sentry', package: 'sentry-sdk', source: 'pypistats', group: 'new' },
  { company: 'pinecone', package: 'pinecone', source: 'pypistats', group: 'new' },
  { company: 'prefect', package: 'prefect', source: 'pypistats', group: 'new' },
  { company: 'dagster', package: 'dagster', source: 'pypistats', group: 'new' },
  { company: 'convex', package: 'convex', source: 'npm', group: 'new' },
  { company: 'resend', package: 'resend', source: 'npm', group: 'new' },
  { company: 'clerk', package: '@clerk/nextjs', source: 'npm', group: 'new' },
] as const;
const metric = (s: typeof primary[number]) => `${s.source === 'npm' ? 'npm' : 'pypi'}_downloads:${s.package}`;

async function collect() {
  if (existsSync(RAW)) { console.log('Using cached research data:', RAW); return; }
  const points = new FileModelStore().readPoints().filter(p => /^(npm|pypi)_downloads:/.test(p.metricId) && p.periodEnd >= START && p.periodEnd <= END);
  const fetchedAt = new Date().toISOString();
  for (const s of primary.filter(s => s.group === 'new')) {
    const url = s.source === 'npm'
      ? `https://api.npmjs.org/downloads/range/${START}:${END}/${encodeURIComponent(s.package)}`
      : `https://pypistats.org/api/packages/${s.package}/overall?mirrors=false`;
    const cached = join(DIR, `${s.company}-raw.json`);
    let body;
    if (existsSync(cached)) body = JSON.parse(readFileSync(cached, 'utf8'));
    else {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`${s.company}: HTTP ${response.status}`);
      body = await response.json();
    }
    const rows: { day?: string; date?: string; downloads: number; category?: string }[] = s.source === 'npm' ? body.downloads : body.data;
    let count = 0;
    for (const r of rows) {
      const day = r.day ?? r.date!;
      if (day < START || day > END || (s.source === 'pypistats' && r.category !== 'without_mirrors')) continue;
      points.push({ companyId: s.company, metricId: metric(s), source: s.source, value: r.downloads, periodStart: day, periodEnd: day,
        availableAt: `${addDays(day, 2)}T00:00:00.000Z`, fetchedAt, sourceUrl: url, provenance: 'scraped', simulated: false });
      count++;
    }
    // Checkpoint prevents refetching successful requests after a partial failure.
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, `${s.company}-raw.json`), JSON.stringify(body));
    console.log(`${s.company}: ${count} daily points`);
    await new Promise(resolve => setTimeout(resolve, s.source === 'pypistats' ? 2100 : 350));
  }
  writeFileSync(RAW, JSON.stringify(points));
}

async function collectLong() {
  mkdirSync(DIR, { recursive: true });
  const points = new FileModelStore().readPoints().filter(p => p.metricId.startsWith('npm_downloads:') && p.periodEnd <= END);
  for (const s of primary.filter(s => s.group === 'new' && s.source === 'npm')) {
    for (let start = '2023-01-01'; start <= END; start = addDays(start, 540)) {
      const end = addDays(start, 539) < END ? addDays(start, 539) : END;
      const url = `https://api.npmjs.org/downloads/range/${start}:${end}/${encodeURIComponent(s.package)}`;
      const cached = join(DIR, `${s.company}-${start}-raw.json`);
      let body;
      if (existsSync(cached)) body = JSON.parse(readFileSync(cached, 'utf8'));
      else {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`${s.company}: HTTP ${response.status}`);
        body = await response.json();
        writeFileSync(cached, JSON.stringify(body));
      }
      for (const r of body.downloads) points.push({ companyId: s.company, metricId: metric(s), source: 'npm', value: r.downloads,
        periodStart: r.day, periodEnd: r.day, availableAt: `${addDays(r.day, 2)}T00:00:00.000Z`, fetchedAt: new Date().toISOString(),
        sourceUrl: url, provenance: 'scraped', simulated: false });
      console.log(`${s.company}: ${start} through ${end}`);
      await new Promise(resolve => setTimeout(resolve, 350));
    }
  }
  writeFileSync(join(DIR, 'long-points.json'), JSON.stringify(points));
}

function summarize(cases: BacktestCase[]) {
  const ys = cases.map(c => c.outcome);
  const ps = cases.map(c => caseProbability(c, shipped, defaultParams));
  const one = (s: TunedSettings) => score(cases.map(c => caseProbability(c, s, defaultParams)), ys);
  return {
    cases: cases.length, fits: uniqueFits(cases).length, origins: new Set(cases.map(c => c.dataThrough)).size,
    shipped: one(shipped), persistenceSameSpread: one(persistence),
    pre2025TunedModel: one(calibratedModel), pre2025TunedPersistence: one(calibratedPersistence),
    fiftyFifty: score(cases.map(() => 0.5), ys),
    calibrationError: expectedCalibrationError(calibrationTable(ps, ys)),
    calibration: calibrationTable(ps, ys),
    medianForecastError: medianApe(cases, shipped), persistenceMedianError: medianApe(cases, persistence),
    displayedRangeCoverage: rangeCoverage(cases, { ...shipped, sigmaScale: defaultParams.rangeSigmaScale, driftPerWeek: defaultParams.rangeDriftPerWeek }, defaultParams),
    frozenModelAdvantage: bootstrapAdvantage(cases),
    horizons: [1, 2, 4, 8].map(h => {
      const cs = cases.filter(c => c.horizon === h);
      return { horizon: h, fits: uniqueFits(cs).length, model: oneFor(cs, shipped), persistence: oneFor(cs, persistence), medianForecastError: medianApe(cs, shipped) };
    }),
  };
}
// Pair scores on the same cases; preserve thresholds/horizons together and
// resample four consecutive weekly origins to reduce overlap dependence.
function bootstrapAdvantage(cases: BacktestCase[]) {
  const dates = [...new Set(cases.map(c => c.dataThrough))].sort();
  if (!dates.length) return null;
  const groups = dates.map(date => {
    const cs = cases.filter(c => c.dataThrough === date);
    return { n: cs.length, sum: cs.reduce((sum, c) => {
      const pm = caseProbability(c, calibratedModel, defaultParams);
      const pp = caseProbability(c, calibratedPersistence, defaultParams);
      return sum + (pp - c.outcome) ** 2 - (pm - c.outcome) ** 2;
    }, 0) };
  });
  const random = seededRandom(20261009);
  const samples: number[] = [];
  const block = Math.min(4, dates.length);
  for (let b = 0; b < 2000; b++) {
    let n = 0, sum = 0, taken = 0;
    while (taken < groups.length) {
      const start = Math.floor(random() * (groups.length - block + 1));
      for (let j = 0; j < block && taken < groups.length; j++, taken++) {
        sum += groups[start + j].sum; n += groups[start + j].n;
      }
    }
    samples.push(sum / n);
  }
  samples.sort((a, b) => a - b);
  return { origins: dates.length, blockWeeks: block,
    mean: groups.reduce((s, g) => s + g.sum, 0) / cases.length,
    interval95: [samples[50], samples[1950]],
    note: 'Exploratory paired moving-block bootstrap; positive favors model. Not adjusted for candidate selection or shared registry shocks.' };
}
function oneFor(cs: BacktestCase[], settings: TunedSettings) {
  return score(cs.map(c => caseProbability(c, settings, defaultParams)), cs.map(c => c.outcome));
}

function evaluate() {
  const points: DataPoint[] = JSON.parse(readFileSync(RAW, 'utf8'));
  const keys = [...new Set(points.map(p => p.metricId))];
  const allCases = new Map(keys.map(m => [m, buildCases(points, m, defaultParams).filter(c => c.dataThrough >= TEST_START)]));
  const matchKey = (c: BacktestCase) => `${c.dataThrough}|${c.horizon}`;
  const primarySets = primary.map(s => new Set((allCases.get(metric(s)) ?? []).map(matchKey)));
  const common = new Set([...primarySets[0]].filter(k => primarySets.every(set => set.has(k))));
  const rows = keys.map(m => {
    const ps = points.filter(p => p.metricId === m);
    const cs = allCases.get(m)!;
    const s = primary.find(s => metric(s) === m);
    const series = buildDailySeries(ps, m, new Date(AS_OF));
    let latestEnd = END;
    while (windowTotal(series, toDayNumber(latestEnd)) === null) latestEnd = addDays(latestEnd, -7);
    const latest = { windowEnd: latestEnd, total: windowTotal(series, toDayNumber(latestEnd))! };
    const company = ps[0].companyId;
    const scenarios = [1, 4, 8].flatMap(h => [1, 1.1, 1.25].map(multiplier => {
      const windowEnd = addDays(END, h * 7);
      const question: ThresholdQuestion = {
        id: `research-${company}-${m}-${h}-${multiplier}`, companyId: company, metricId: m,
        threshold: Math.round(latest.total! * multiplier), windowEnd, windowDays: 7,
        text: `Will ${m} reach ${multiplier} times the last complete week in the 7 days ending ${windowEnd}?`,
        resolutionSource: { source: ps[0].source, url: ps[0].sourceUrl, description: 'Public daily download totals' }, opensAt: AS_OF,
      };
      const result = computeBaseline(question, ps, new Date(AS_OF));
      return { horizon: h, multiplier, question, ...result };
    }));
    const failures = [...cs].sort((a, b) => {
      const loss = (c: BacktestCase) => (caseProbability(c, shipped, defaultParams) - c.outcome) ** 2;
      return loss(b) - loss(a);
    }).slice(0, 5).map(c => ({ ...c, probability: caseProbability(c, shipped, defaultParams), forecastMedian: Math.expm1(caseMu(c, shipped)) }));
    return { company, metric: m, group: s?.group ?? 'existing-alternate', days: ps.length,
      firstDay: ps[0].periodEnd, lastDay: ps.at(-1)!.periodEnd,
      zeroDays: series.zeroDaysTreatedAsMissing, recent: summarize(cs),
      matched: summarize(cs.filter(c => common.has(matchKey(c)))),
      recentShort: summarize(cs.filter(c => c.horizon <= 4)), scenarios, failures };
  });
  // Validate the fast backtest path against the actual public baseline function.
  let maxProbabilityDifference = 0;
  for (const row of rows) {
    for (const c of (allCases.get(row.metric) ?? []).filter(c => c.horizon === 4 && c.multiplier === 1.1).slice(-3)) {
      const q: ThresholdQuestion = { id: 'validation', companyId: c.companyId, metricId: c.metricId, threshold: c.threshold,
        windowEnd: c.windowEnd, windowDays: 7, text: 'Validation question',
        resolutionSource: { source: row.metric.startsWith('npm') ? 'npm' : 'pypistats', url: 'https://example.com', description: 'Validation' },
        opensAt: `${addDays(c.dataThrough, 2)}T00:00:00.000Z` };
      const result = computeBaseline(q, points.filter(p => p.metricId === row.metric), new Date(q.opensAt), { params: { ...defaultParams, bootstrapReplicates: 0 } });
      if (result.probability === null) throw new Error('Validation forecast missing');
      maxProbabilityDifference = Math.max(maxProbabilityDifference, Math.abs(result.probability - caseProbability(c, shipped, defaultParams)));
    }
  }
  if (maxProbabilityDifference > 1e-10) throw new Error(`Backtest/public API mismatch: ${maxProbabilityDifference}`);
  const longPath = join(DIR, 'long-points.json');
  const longRows = existsSync(longPath) ? (() => {
    const longPoints: DataPoint[] = JSON.parse(readFileSync(longPath, 'utf8'));
    return [...new Set(longPoints.map(p => p.metricId))].map(m => {
      const cases = buildCases(longPoints, m, defaultParams);
      const test = cases.filter(c => c.dataThrough >= '2025-10-01');
      const beforeShift = test.filter(c => c.windowEnd <= '2026-06-01');
      const afterShift = test.filter(c => c.dataThrough >= '2026-09-20');
      return { company: longPoints.find(p => p.metricId === m)!.companyId, metric: m,
        test: summarize(test), beforeShift: summarize(beforeShift), afterShift: summarize(afterShift) };
    });
  })() : [];
  const result = { generatedAt: new Date().toISOString(), start: START, end: END, asOf: AS_OF, testStart: TEST_START,
    params: defaultParams, persistence, calibratedModel, calibratedPersistence, commonFits: common.size, maxProbabilityDifference,
    method: 'Frozen shipped parameters; synthetic thresholds at 0.8/0.9/1/1.1/1.25/1.5 times the last full week; weekly origins; 1/2/4/8-week horizons; no sponsor data. Historical publication dates assumed, not archived vintages. Existing series were previously used in parameter tuning. Also score settings frozen from pre-2025-10 calibration.', rows, longRows };
  writeFileSync(join(DIR, 'results.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(DIR, 'cases.json'), JSON.stringify([...allCases.entries()]));
  const f = (n: number) => Number.isFinite(n) ? n.toFixed(3) : 'N/A';
  const report = [
    '# Candidate model evaluation', '',
    'Run on October 9, 2026 (Eastern), using data through October 8. No production catalog, parameters, database, or baselines changed.', '',
    '## Method', '', result.method, '',
    'All 14 primary company series share April 8–October 8 history for the recent comparison. Origins start July 1. Only the same origin/horizon combinations available for every primary series enter the matched table. Each fit produces six correlated threshold questions; cases are not independent observations.', '',
    `Matched comparison: ${common.size} origin/horizon fits (${common.size * 6} threshold cases). Fast backtest probabilities matched the public computeBaseline API exactly on up to three historical 4-week/1.1× cases per series (maximum difference ${maxProbabilityDifference}). Current scenarios run the public API with its full bootstrap.`, '',
    'Lower Brier is better; a constant 50% forecast scores 0.250. Persistence carries the last complete week forward. The recent table uses the same probability spread for both methods. Longer-history tables use the separately tuned model and persistence settings saved from the pre-October-2025 calibration period; no candidate-specific tuning was done.', '',
    '## Matched recent comparison', '',
    '| Company | Package metric | Existing/new | Model Brier | Persistence Brier |',
    '|---|---|---|---:|---:|',
    ...rows.filter(r => r.group !== 'existing-alternate').sort((a,b) => a.matched.shipped.brier - b.matched.shipped.brier).map(r => `| ${r.company} | ${r.metric} | ${r.group} | ${f(r.matched.shipped.brier)} | ${f(r.matched.persistenceSameSpread.brier)} |`), '',
    '## Longer npm check', '',
    'Histories begin January 2023. Test origins start October 1, 2025. The pre-shift subset requires the target window to end by June 1, 2026, excluding the recent npm counting jumps. The frozen pre-2025 model avoids the shipped settings being tuned on this test period. Company-series correlation still limits generalization.', '',
    '| Company/package | Fits in test | Model Brier | Persistence Brier | Pre-shift model | Pre-shift persistence | Paired improvement 95% range |',
    '|---|---:|---:|---:|---:|---:|---|',
    ...longRows.sort((a,b) => a.test.pre2025TunedModel.brier - b.test.pre2025TunedModel.brier).map(r => `| ${r.metric} | ${r.test.fits} | ${f(r.test.pre2025TunedModel.brier)} | ${f(r.test.pre2025TunedPersistence.brier)} | ${f(r.beforeShift.pre2025TunedModel.brier)} | ${f(r.beforeShift.pre2025TunedPersistence.brier)} | ${r.test.frozenModelAdvantage?.interval95.map(f).join(' to ')} |`), '',
    'The improvement intervals use a paired four-origin moving-block bootstrap (2,000 samples). Positive favors the model. These are exploratory intervals, not adjusted for selection across candidates or shared source shocks.', '',
    '## Current four-week scenarios', '',
    'Question: will the exact package have at least 110% of its latest complete seven-day total during the seven days ending November 5, 2026 (UTC)? Thresholds are illustrative and were fixed before observing the probabilities. These are unresolved forecasts, not evidence of accuracy. Prices shown are proposed model starting YES values for LMSR; no live market was created.', '',
    '| Company | Last complete week end | Threshold downloads | Forecast median | YES probability | Model uncertainty band | Complete fit weeks |',
    '|---|---|---:|---:|---:|---|---:|',
    ...rows.filter(r => r.group !== 'existing-alternate').map(r => {
      const s = r.scenarios.find(s => s.horizon === 4 && s.multiplier === 1.1)!;
      return `| ${r.company} | ${s.method.details.lastObservedWeek?.windowEnd} | ${s.question.threshold.toLocaleString('en-US')} | ${Math.round(s.method.details.forecastMedian!).toLocaleString('en-US')} | ${(s.probability! * 100).toFixed(1)}% | ${(s.low! * 100).toFixed(1)}–${(s.high! * 100).toFixed(1)}% | ${s.method.details.weeksUsed} |`;
    }), '',
    '## Historical failures worth inspecting', '',
    '| Company | Forecast data through | Target window end | YES forecast | Threshold downloads | Actual downloads | Outcome |',
    '|---|---|---|---:|---:|---:|---|',
    ...rows.filter(r => ['databricks', 'huggingface', 'sentry'].includes(r.company) && r.group !== 'existing-alternate').map(r => {
      const c = r.failures[0];
      return `| ${r.company} | ${c.dataThrough} | ${c.windowEnd} | ${(c.probability * 100).toFixed(1)}% | ${c.threshold.toLocaleString('en-US')} | ${c.actual.toLocaleString('en-US')} | ${c.outcome ? 'YES' : 'NO'} |`;
    }), '',
    '## Interpretation and limits', '',
    '- Strongest new candidates: Resend, Convex and Clerk. Resend stays strong on the longer and pre-shift comparisons. Stripe is strongest among existing npm series; Vercel CLI, Supabase and PostHog also beat persistence in the longer test.',
    '- Python availability did not translate to better model output. Databricks, Hugging Face, Sentry, Pinecone and Dagster lose to persistence. Prefect and Modal are mixed; do not promote them based on accessible data alone.',
    '- The existing-company alternate packages are in results.json. Vercel CLI beats next; Hugging Face npm is substantially better than its PyPI series but still loses to persistence over the longer test. Existing Python alternatives for Supabase, Stripe and PostHog also lose to persistence.',
    '- All npm candidates inherit registry outages and shared level shifts, potentially caused by automated traffic or counting changes. Current npm fits have only 9–10 complete weeks of the nominal 16; the last usable weekly total ends October 1. Predicting the counter well does not establish customer growth.',
    '- Python displayed 80% range coverage is only about 44–63% in the recent own-available tests. Several Python series gave roughly 97.5% YES for historical questions that resolved NO. No-zero daily histories concealed structural breaks.',
    '- Original six-company observations are cached from the existing committed collection; new candidates were freshly collected. Counts may be revised after publication, so this is a retrospective reconstruction, not an archived-vintage backtest.',
    '- Thresholds, overlapping horizons and registry-wide movements are correlated. The recent matched test is small. Existing series helped tune the shipped settings. Selection after inspecting these results requires a future prospective holdout.', '',
    '## Reproduce', '',
    '```sh',
    'node node_modules/tsx/dist/cli.mjs lib/model/cli/evaluate-candidates.ts --collect',
    'node node_modules/tsx/dist/cli.mjs lib/model/cli/evaluate-candidates.ts --collect-long',
    'node node_modules/tsx/dist/cli.mjs lib/model/cli/evaluate-candidates.ts',
    '```', '',
    'Collection uses isolated caches in data/model/candidate-evaluation. Raw API responses, normalized points, cases and results are preserved there. Cached responses prevent repeated collection.', '',
  ].join('\n');
  writeFileSync(join(DIR, 'report.md'), report);
  console.table(rows.map(r => ({ company: r.company, metric: r.metric, group: r.group, fits: r.recent.fits,
    brier: r.recent.shipped.brier.toFixed(3), persistence: r.recent.persistenceSameSpread.brier.toFixed(3),
    matched: r.matched.shipped.brier.toFixed(3), short: r.recentShort.shipped.brier.toFixed(3),
    mape: (r.recent.medianForecastError * 100).toFixed(1), coverage80: (r.recent.displayedRangeCoverage * 100).toFixed(0),
    p4w10: (r.scenarios.find(s => s.horizon === 4 && s.multiplier === 1.1)!.probability! * 100).toFixed(1) })));
  console.log(JSON.stringify({ commonFits: common.size, maxProbabilityDifference, output: join(DIR, 'results.json') }));
}

if (process.argv.includes('--collect-long')) collectLong().catch(error => { console.error(error); process.exitCode = 1; });
else if (process.argv.includes('--collect')) collect().catch(error => { console.error(error); process.exitCode = 1; });
else evaluate();
