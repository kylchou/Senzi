// Runs the backtest over all collected download series and writes
//   data/model/backtest/results.json
//   docs/model-backtest.md
//
//   npx tsx lib/model/cli/backtest.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  averageBandWidth,
  buildCases,
  calibrationTable,
  caseProbability,
  expectedCalibrationError,
  indexCaseProbability,
  indexMedianApe,
  indexRangeCoverage,
  medianApe,
  rangeCoverage,
  PERSISTENCE,
  score,
  tuneIndexSettings,
  tuneRangeSigma,
  tuneSettings,
  uniqueFits,
  type BacktestCase,
  type CalibrationBin,
  type IndexBacktestInput,
  type IndexTunedSettings,
  type Scores,
  type TunedSettings,
} from '../backtest';
import { COMPANIES, NPM_INDEX_PACKAGES } from '../catalog';
import { defaultParams, type ModelParams } from '../params';
import { DEFAULT_DATA_DIR, FileModelStore } from '../store';

/** Tune on as-of dates before this day; score on dates from it on. */
const SPLIT = '2025-10-01';
/** Start of the 2026 npm-wide shift, reported separately. */
const SHIFT_FROM = '2026-07-01';

const store = new FileModelStore();
// Only the selected demo companies; files left from earlier selections are ignored.
const companyIds = new Set(COMPANIES.map((c) => c.id));
const points = store.readPoints().filter((p) => companyIds.has(p.companyId));
const npmIndexPoints = store.readNpmIndexPoints();
const metrics = [...new Set(points.map((p) => p.metricId))].filter((m) => /^(npm|pypi)_downloads:/.test(m)).sort();
const indexInput = (betaWeeks: number | null): IndexBacktestInput | undefined =>
  defaultParams.npmIndex && npmIndexPoints.length ? { points: npmIndexPoints, params: { ...defaultParams.npmIndex, betaWeeks }, cache: new Map() } : undefined;

console.log(`Building cases for ${metrics.length} series...`);
const t0 = Date.now();
// npm cases also carry an index-adjusted fit (case.adj); the raw-model results below ignore it.
const all: BacktestCase[] = metrics.flatMap((m) => buildCases(points, m, defaultParams, undefined, indexInput(defaultParams.npmIndex?.betaWeeks ?? null)));
console.log(`${all.length} cases (${uniqueFits(all).length} fits) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const calib = all.filter((c) => c.dataThrough < SPLIT);
const test = all.filter((c) => c.dataThrough >= SPLIT);

const ORIGINAL = { levelAnchor: 'line', trendDamping: 1, tailShrink: 0 } as const;
const tunedTrend = tuneSettings(calib, defaultParams);
const tunedOriginal = tuneSettings(calib, defaultParams, ORIGINAL);
const tunedPersist = tuneSettings(calib, defaultParams, PERSISTENCE);
// Score the actual running settings; do not relabel a new all-data fit as shipped.
const shipped: TunedSettings = { ...defaultParams };
const untuned: TunedSettings = { sigmaScale: 1, driftPerWeek: 0, ...ORIGINAL };

const ys = (cs: BacktestCase[]) => cs.map((c) => c.outcome);
const probs = (cs: BacktestCase[], s: TunedSettings, params: ModelParams = defaultParams) => cs.map((c) => caseProbability(c, s, params));

function evaluate(cs: BacktestCase[]) {
  const y = ys(cs);
  const calibBase = score(calib.map(() => 0.5), ys(calib)).baseRate;
  return {
    trend: score(probs(cs, tunedTrend), y),
    original: score(probs(cs, tunedOriginal), y),
    trendUntuned: score(probs(cs, untuned), y),
    persistence: score(probs(cs, tunedPersist), y),
    fiftyFifty: score(cs.map(() => 0.5), y),
    baseRate: score(cs.map(() => calibBase), y),
  };
}

const testEval = evaluate(test);
const byHorizon = [1, 2, 4, 8].map((h) => {
  const cs = test.filter((c) => c.horizon === h);
  return {
    horizon: h,
    ...evaluate(cs),
    medianApeTrend: medianApe(cs, tunedTrend),
    medianApePersistence: medianApe(cs, PERSISTENCE),
    coverage80: rangeCoverage(cs, tunedTrend, defaultParams),
  };
});
const bySeries = metrics.map((m) => {
  const cs = test.filter((c) => c.metricId === m);
  return cs.length
    ? { metricId: m, n: cs.length, ...evaluate(cs), medianApe4w: medianApe(cs.filter((c) => c.horizon === 4), tunedTrend) }
    : { metricId: m, n: 0 };
});
const calibrationTest = calibrationTable(probs(test, tunedTrend), ys(test));

// Thin data: refit with only 5 weeks and compare shrinkage on/off.
const thinParams: ModelParams = { ...defaultParams, fitWeeks: 5 };
const thinCases = metrics.flatMap((m) => buildCases(points, m, thinParams)).filter((c) => c.dataThrough >= SPLIT);
const noShrink: ModelParams = { ...thinParams, minShrinkWeight: 1 };
const thin = {
  n: thinCases.length,
  withShrink: score(probs(thinCases, tunedTrend, thinParams), ys(thinCases)),
  withoutShrink: score(probs(thinCases, tunedTrend, noShrink), ys(thinCases)),
};

const bandWidth = averageBandWidth(points, test, { ...defaultParams, ...tunedTrend, levelAnchor: tunedTrend.levelAnchor === 'line' ? 'line' : 'last' });

// Displayed 80% range: tuned for coverage on calibration data, checked on test data.
const rangeCalib = tuneRangeSigma(calib, tunedTrend, defaultParams);
// Shipped range spread uses the most recent 12 months: 2026 is far more volatile than earlier years.
const rangeShipped = { rangeSigmaScale: defaultParams.rangeSigmaScale, rangeDriftPerWeek: defaultParams.rangeDriftPerWeek };
const rangeTestCoverage = [1, 2, 4, 8].map((h) =>
  rangeCoverage(test.filter((c) => c.horizon === h), { ...tunedTrend, sigmaScale: rangeCalib.rangeSigmaScale, driftPerWeek: rangeCalib.rangeDriftPerWeek }, defaultParams),
);

// Shipped settings on the test period. In-sample (they were tuned on all cases), shown for transparency only.
const shippedOnTest = {
  scores: score(probs(test, shipped), ys(test)),
  coverage80ByHorizon: [1, 2, 4, 8].map((h) => rangeCoverage(test.filter((c) => c.horizon === h), {
    ...shipped, sigmaScale: rangeShipped.rangeSigmaScale, driftPerWeek: rangeShipped.rangeDriftPerWeek,
  }, defaultParams)),
  ece: expectedCalibrationError(calibrationTable(probs(test, shipped), ys(test))),
};

// Sensitivity to the fit window. Selection uses the calibration period only.
console.log('Fit-window sensitivity...');
const fitWindow = [8, 12, 16, 26].map((fitWeeks) => {
  const params = { ...defaultParams, fitWeeks };
  const cs = metrics.flatMap((m) => buildCases(points, m, params));
  const cal = cs.filter((c) => c.dataThrough < SPLIT);
  const tst = cs.filter((c) => c.dataThrough >= SPLIT);
  const tuned = tuneSettings(cal, params);
  return { fitWeeks, calibrationLogLoss: tuned.logLoss, test: score(probs(tst, tuned, params), ys(tst)) };
});

// Level-shift detection threshold. Selection uses the calibration period only.
console.log('Level-shift sensitivity...');
const levelShift = [null, 0.2, 0.3, 0.4, 0.5].map((levelShiftThreshold) => {
  const params = { ...defaultParams, levelShiftThreshold };
  const cs = metrics.flatMap((m) => buildCases(points, m, params));
  const cal = cs.filter((c) => c.dataThrough < SPLIT);
  const tst = cs.filter((c) => c.dataThrough >= SPLIT);
  const tuned = tuneSettings(cal, params);
  return { levelShiftThreshold, calibrationLogLoss: tuned.logLoss, test: score(probs(tst, tuned, params), ys(tst)) };
});

// npm index: the same npm cases fitted relative to the npm-wide index.
// Tuned on calibration cases, compared with the shipped raw settings on the same test cases.
console.log('npm index...');
const npmIndex = evaluateIndex();

function evaluateIndex() {
  const withIndex = all.filter((c) => c.adj);
  if (!withIndex.length || !defaultParams.npmIndex) return null;
  const cal = withIndex.filter((c) => c.dataThrough < SPLIT);
  const tst = withIndex.filter((c) => c.dataThrough >= SPLIT);
  const tuned = tuneIndexSettings(cal, defaultParams, shipped);
  const ix = defaultParams.npmIndex;
  const shippedIndex: IndexTunedSettings = { ...shipped, ...ix, levelAnchor: defaultParams.levelAnchor };
  const compare = (cs: BacktestCase[]) => ({
    n: cs.length,
    raw: score(probs(cs, shipped), ys(cs)),
    index: score(cs.map((c) => indexCaseProbability(c, shippedIndex, defaultParams, shipped)), ys(cs)),
  });
  const bins = (ps: number[], cs: BacktestCase[]) => expectedCalibrationError(calibrationTable(ps, ys(cs)));
  // Alternatives on the test period, for information only (not used to choose settings).
  const variants = ([[0, 1], [0.5, 1], [1, 1], [1, 2]] as const).map(([indexTrendDamping, indexSigmaScale]) => {
    const v = { ...shippedIndex, indexTrendDamping, indexSigmaScale };
    const sc = (cs: BacktestCase[]) => score(cs.map((c) => indexCaseProbability(c, v, defaultParams, shipped)), ys(cs));
    return { indexTrendDamping, indexSigmaScale, test: sc(tst), shiftPeriod: sc(tst.filter((c) => c.dataThrough >= SHIFT_FROM)) };
  });
  // Estimated beta (how strongly each package moves with npm) instead of 1.
  const betaCases = metrics.filter((m) => m.startsWith('npm_downloads:')).flatMap((m) => buildCases(points, m, defaultParams, undefined, indexInput(52))).filter((c) => c.adj);
  const betaTuned = tuneIndexSettings(betaCases.filter((c) => c.dataThrough < SPLIT), defaultParams, shipped);
  const betaTest = betaCases.filter((c) => c.dataThrough >= SPLIT);
  const betaScore = (cs: BacktestCase[]) => score(cs.map((c) => indexCaseProbability(c, betaTuned, defaultParams, shipped)), ys(cs));
  return {
    packages: [...NPM_INDEX_PACKAGES],
    cases: { calibration: cal.length, test: tst.length },
    tunedOnCalibration: tuned,
    rawCalibrationLogLoss: score(probs(cal, shipped), ys(cal)).logLoss,
    shipped: shippedIndex,
    test: compare(tst),
    shiftPeriod: compare(tst.filter((c) => c.dataThrough >= SHIFT_FROM)),
    byHorizon: [1, 2, 4, 8].map((h) => {
      const cs = tst.filter((c) => c.horizon === h);
      return {
        horizon: h,
        ...compare(cs),
        medianApeRaw: medianApe(cs, shipped),
        medianApeIndex: indexMedianApe(cs, shippedIndex),
        coverageRaw: rangeCoverage(cs, shipped, defaultParams),
        coverageIndex: indexRangeCoverage(cs, shippedIndex, defaultParams),
      };
    }),
    bySeries: [...new Set(tst.map((c) => c.metricId))].sort().map((m) => ({ metricId: m, ...compare(tst.filter((c) => c.metricId === m)) })),
    ece: {
      raw: bins(probs(tst, shipped), tst),
      index: bins(tst.map((c) => indexCaseProbability(c, shippedIndex, defaultParams, shipped)), tst),
    },
    variants,
    estimatedBeta: { tuned: betaTuned, test: betaScore(betaTest), shiftPeriod: betaScore(betaTest.filter((c) => c.dataThrough >= SHIFT_FROM)) },
  };
}

const results = {
  generatedAt: new Date().toISOString(),
  split: SPLIT,
  series: metrics,
  cases: { all: all.length, calibration: calib.length, test: test.length, fits: uniqueFits(all).length },
  tunedOnCalibration: { trend: tunedTrend, original: tunedOriginal, persistence: tunedPersist },
  shippedParams: shipped,
  test: testEval,
  byHorizon,
  bySeries,
  calibration: calibrationTest,
  ece: expectedCalibrationError(calibrationTest),
  thinData: thin,
  averageBandWidth: bandWidth,
  shippedOnTest,
  fitWindow,
  levelShift,
  range: { tunedOnCalibration: rangeCalib, testCoverageByHorizon: rangeTestCoverage, shipped: rangeShipped },
  npmIndex,
};

mkdirSync(join(DEFAULT_DATA_DIR, 'backtest'), { recursive: true });
writeFileSync(join(DEFAULT_DATA_DIR, 'backtest', 'results.json'), JSON.stringify(results, null, 2) + '\n');
writeFileSync(join(process.cwd(), 'docs', 'model-backtest.md'), renderMarkdown());
console.log(JSON.stringify({ range: results.range, tunedTrend, tunedOriginal, tunedPersist, shipped, test: testEval, ece: results.ece, thin, bandWidth }, null, 2));

// ---------------------------------------------------------------------------

function f(x: number | null | undefined, d = 3) {
  return x === null || x === undefined || Number.isNaN(x) ? '–' : x.toFixed(d);
}
function pct(x: number | null | undefined, d = 0) {
  return x === null || x === undefined || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(d)}%`;
}
function fitWindowNote(): string {
  const best = [...fitWindow].sort((a, b) => a.calibrationLogLoss - b.calibrationLogLoss)[0]!;
  const bestTest = [...fitWindow].sort((a, b) => a.test.logLoss - b.test.logLoss)[0]!;
  const used = defaultParams.fitWeeks;
  const choice =
    best.fitWeeks === used
      ? `The model uses ${used} weeks (set in the plan before any backtest), which is also the best window on calibration data.`
      : `The model uses ${used} weeks (set in the plan before any backtest). On calibration data ${best.fitWeeks} weeks scores best.`;
  const test =
    bestTest.fitWeeks === best.fitWeeks
      ? ' The test period agrees.'
      : ` On the test period ${bestTest.fitWeeks} weeks scores best, but choosing a window because of test results would overfit the test period.`;
  return choice + test;
}
function settingsRow(name: string, s: TunedSettings) {
  return `| ${name} | ${s.levelAnchor} | ${s.trendDamping} | ${s.tailShrink} | ${s.sigmaScale} | ${s.driftPerWeek} |`;
}
function row(name: string, s: Scores) {
  return `| ${name} | ${f(s.brier)} | ${f(s.logLoss)} |`;
}
function calibRows(bins: CalibrationBin[]) {
  return bins
    .filter((b) => b.n)
    .map((b) => `| ${pct(b.lower)}–${pct(b.upper)} | ${b.n} | ${pct(b.meanPredicted, 1)} | ${pct(b.observed, 1)} |`)
    .join('\n');
}

function renderIndex(): string {
  const ix = results.npmIndex;
  if (!ix) return '## npm index\n\nNo npm index data (`data/model/npm-index.jsonl`); not evaluated.\n';
  const cmp = (name: string, c: { n: number; raw: Scores; index: Scores }) =>
    `| ${name} | ${c.n} | ${f(c.raw.brier)} | ${f(c.index.brier)} | ${f(c.raw.logLoss)} | ${f(c.index.logLoss)} |`;
  const s = ix.shipped;
  return `## npm index

npm questions are fitted relative to an npm-wide index: the equal-weighted mean of log 7-day totals for ${ix.packages.length} large, unrelated packages (${ix.packages.join(', ')}). See \`lib/model/npm-index.ts\`. The rows below score the raw model (shipped settings) and the index model on the same npm cases (${ix.cases.calibration} calibration, ${ix.cases.test} test).

Index settings tuned on the calibration period: index trend carried ${s.indexTrendDamping}, index spread × ${s.indexSigmaScale}, level anchor ${s.levelAnchor}, trend damping ${s.trendDamping}, tail shrink ${s.tailShrink}, σ scale ${s.sigmaScale}, drift ${s.driftPerWeek}. Calibration-period log loss: index ${f(ix.tunedOnCalibration.logLoss)}, raw ${f(ix.rawCalibrationLogLoss)}.

| Cases | n | Brier (raw) | Brier (index) | Log loss (raw) | Log loss (index) |
| --- | --- | --- | --- | --- | --- |
${cmp('Test period', ix.test)}
${cmp(`As-of ${SHIFT_FROM} on (npm-wide shift)`, ix.shiftPeriod)}
${ix.byHorizon.map((h) => cmp(`${h.horizon} week(s) ahead`, h)).join('\n')}
${ix.bySeries.map((x) => cmp(x.metricId, x)).join('\n')}

Calibration error on the test period: raw ${f(ix.ece.raw)}, index ${f(ix.ece.index)}. Median absolute error of the median forecast at 1/2/4/8 weeks: raw ${ix.byHorizon.map((h) => pct(h.medianApeRaw, 1)).join(' / ')}, index ${ix.byHorizon.map((h) => pct(h.medianApeIndex, 1)).join(' / ')}. Actual totals inside the probability model's 80% range: raw ${ix.byHorizon.map((h) => pct(h.coverageRaw)).join(' / ')}, index ${ix.byHorizon.map((h) => pct(h.coverageIndex)).join(' / ')}.

Alternatives, scored on the test period for information only (settings are chosen on the calibration period):

| Index trend carried | Index spread × | Test Brier | Test log loss | Shift-period Brier |
| --- | --- | --- | --- | --- |
${ix.variants.map((v) => `| ${v.indexTrendDamping} | ${v.indexSigmaScale} | ${f(v.test.brier)} | ${f(v.test.logLoss)} | ${f(v.shiftPeriod.brier)} |`).join('\n')}

Assuming npm stays at its current level (index trend 0) scores worst, including during the shift: npm kept growing after the jump. Estimating how strongly each package moves with npm (beta from 52 weeks, instead of 1) scored test Brier ${f(ix.estimatedBeta.test.brier)} and shift-period Brier ${f(ix.estimatedBeta.shiftPeriod.brier)}, about the same as beta = 1. The weekly estimates swing widely between dates, so the simpler beta = 1 is used.

**Reading this.** The index model is better calibrated and better during the npm-wide shift, slightly worse over the whole test period, and worse on some series. Holiday weeks (Dec 20 – Jan 10) are left out of the index's spread unless the question's own span touches them.
`;
}

function renderMarkdown(): string {
  const t = results.test;
  return `# Model backtest

Generated by \`npx tsx lib/model/cli/backtest.ts\` on ${results.generatedAt.slice(0, 10)}. Raw numbers: \`data/model/backtest/results.json\`.

## Setup

- **Series:** ${metrics.length} download series (${metrics.join(', ')}). npm history starts 2023-01-01; PyPI (pypistats) only covers about the last 180 days.
- **As-of dates:** weekly. At each date the model sees only data published by then.
- **Questions (synthetic):** "Will the 7-day total for the window ending h weeks later be at least T?" for h = 1, 2, 4, 8 weeks and T = 0.8, 0.9, 1.0, 1.1, 1.25, 1.5 × the last complete week.
- **Out-of-sample split:** all tuned settings (σ scale, drift, level anchor, trend damping, tail shrink) are chosen on as-of dates before ${SPLIT} (${results.cases.calibration} cases) and scored on dates from ${SPLIT} on (${results.cases.test} cases). PyPI series only appear in the test period.
- **Comparisons:** 50/50; the calibration-period base rate; persistence (last week carried forward, with its own tuned spread); the original v1 design (trend line level, full trend, σ tuned); and v1 with untuned σ.

## Tuned settings

| | Level anchor | Trend damping | Tail shrink | sigmaScale | driftPerWeek |
| --- | --- | --- | --- | --- | --- |
${settingsRow('Model, tuned on calibration period (scored below)', results.tunedOnCalibration.trend)}
${settingsRow('Original design, σ tuned on calibration period', results.tunedOnCalibration.original)}
${settingsRow('Persistence, σ tuned on calibration period', results.tunedOnCalibration.persistence)}
${settingsRow('Actual shipped settings in lib/model/params.ts (unchanged)', results.shippedParams)}

## Out-of-sample scores (lower is better)

| Model | Brier | Log loss |
| --- | --- | --- |
${row('Model (tuned)', t.trend)}
${row('Original design (σ tuned)', t.original)}
${row('Original design (untuned σ)', t.trendUntuned)}
${row('Persistence (tuned σ)', t.persistence)}
${row('Base rate', t.baseRate)}
${row('50/50', t.fiftyFifty)}

Base rate of YES in the test period: ${pct(t.trend.baseRate, 1)}.

### By horizon

| Weeks ahead | Brier (model) | Brier (persistence) | Log loss (model) | Median abs. error of forecast (model) | (persistence) | Actual inside 80% range |
| --- | --- | --- | --- | --- | --- | --- |
${byHorizon.map((h) => `| ${h.horizon} | ${f(h.trend.brier)} | ${f(h.persistence.brier)} | ${f(h.trend.logLoss)} | ${pct(h.medianApeTrend, 1)} | ${pct(h.medianApePersistence, 1)} | ${pct(h.coverage80)} |`).join('\n')}

The last column checks σ: about 80% of actual totals should fall inside the model's 80% forecast range.

### By series

| Series | Cases | Brier (model) | Brier (persistence) | Median abs. error, 4 weeks ahead |
| --- | --- | --- | --- | --- |
${bySeries.map((s) => ('trend' in s ? `| ${s.metricId} | ${s.n} | ${f(s.trend!.brier)} | ${f(s.persistence!.brier)} | ${pct(s.medianApe4w, 1)} |` : `| ${s.metricId} | 0 | – | – | – |`)).join('\n')}

### Calibration (test period)

Expected calibration error: ${f(results.ece)}.

| Predicted | Cases | Mean predicted | Observed YES |
| --- | --- | --- | --- |
${calibRows(results.calibration)}

### Shipped settings on the test period (in-sample)

The actual settings in lib/model/params.ts are scored without retuning on this refreshed dataset. They were previously chosen using some overlapping test-period data, so this is not a fresh holdout: Brier ${f(shippedOnTest.scores.brier)}, log loss ${f(shippedOnTest.scores.logLoss)}, calibration error ${f(shippedOnTest.ece)}. Actual totals inside the displayed 80% range at 1/2/4/8 weeks: ${shippedOnTest.coverage80ByHorizon.map((x) => pct(x)).join(' / ')}.

### Displayed 80% forecast range

The displayed range uses its own spread. The calibration-period coverage experiment (σ scale ${rangeCalib.rangeSigmaScale}, drift ${rangeCalib.rangeDriftPerWeek}) covers ${rangeTestCoverage.map((x) => pct(x)).join(' / ')} of actual test-period totals at 1/2/4/8 weeks. Actual shipped range settings remain σ scale ${rangeShipped.rangeSigmaScale}, drift ${rangeShipped.rangeDriftPerWeek}; they are not retuned by this run. They were previously tuned on recent data, so treat the displayed range as a current estimate rather than a validated one.

### Fit window

| Weeks fitted | Calibration log loss (used to choose) | Test Brier | Test log loss |
| --- | --- | --- | --- |
${fitWindow.map((w) => `| ${w.fitWeeks} | ${f(w.calibrationLogLoss, 4)} | ${f(w.test.brier)} | ${f(w.test.logLoss)} |`).join('\n')}

${fitWindowNote()}

### Level-shift detection

| Threshold (log change) | Calibration log loss (used to choose) | Test Brier | Test log loss |
| --- | --- | --- | --- |
${levelShift.map((l) => `| ${l.levelShiftThreshold ?? 'off'} | ${f(l.calibrationLogLoss, 4)} | ${f(l.test.brier)} | ${f(l.test.logLoss)} |`).join('\n')}

A persistent step larger than the threshold restarts the fit after the step. The shipped threshold is ${defaultParams.levelShiftThreshold ?? 'off'}, the best on calibration data. On the test period it is roughly neutral, so treat it as a guard against obvious counting changes (such as the PyPI drop in late August 2026) rather than a proven accuracy gain.

### Thin data (5-week fits, test period)

| | Brier | Log loss |
| --- | --- | --- |
${row('With shrinkage toward 50%', thin.withShrink)}
${row('Without shrinkage', thin.withoutShrink)}

### Band

Average width of the model-uncertainty band (10th–90th percentile) on a sample of test cases: ${f(bandWidth)}.

${renderIndex()}

## Limits of this backtest

- **No revenue ground truth.** None of the demo companies publish revenue, so the model is only tested on public download counts.
- **Synthetic questions.** Thresholds are set relative to the last week. Real sponsor questions may sit elsewhere.
- **Correlated cases.** Six thresholds share each fit, horizons overlap, and all npm series move together in 2026, so the effective sample is much smaller than the case count.
- **Downloads are a noisy proxy.** They include CI and automated installs. Several npm series grew 3–5× in 2026, which looks like ecosystem-wide automated traffic rather than company traction.
- **npm outages.** Days npm reported as 0 are treated as missing, and weeks containing them are skipped as targets and in fits. Outages were frequent from mid-2026, which removes recent weeks.
- **Short PyPI history.** PyPI series have only about 26 weeks, so they contribute few test cases and no calibration-period cases.
- **Data as fetched today.** The backtest assumes published counts were never revised later.
`;
}
