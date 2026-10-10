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
  medianApe,
  rangeCoverage,
  PERSISTENCE,
  score,
  tuneRangeSigma,
  tuneSettings,
  uniqueFits,
  type BacktestCase,
  type CalibrationBin,
  type Scores,
  type TunedSettings,
} from '../backtest.js';
import { defaultParams, type ModelParams } from '../params.js';
import { DEFAULT_DATA_DIR, FileModelStore } from '../store.js';

/** Tune on as-of dates before this day; score on dates from it on. */
const SPLIT = '2025-10-01';

const store = new FileModelStore();
const points = store.readPoints();
const metrics = [...new Set(points.map((p) => p.metricId))].filter((m) => /^(npm|pypi)_downloads:/.test(m)).sort();

console.log(`Building cases for ${metrics.length} series...`);
const t0 = Date.now();
const all: BacktestCase[] = metrics.flatMap((m) => buildCases(points, m, defaultParams));
console.log(`${all.length} cases (${uniqueFits(all).length} fits) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const calib = all.filter((c) => c.dataThrough < SPLIT);
const test = all.filter((c) => c.dataThrough >= SPLIT);

const ORIGINAL = { levelAnchor: 'line', trendDamping: 1, tailShrink: 0 } as const;
const tunedTrend = tuneSettings(calib, defaultParams);
const tunedOriginal = tuneSettings(calib, defaultParams, ORIGINAL);
const tunedPersist = tuneSettings(calib, defaultParams, PERSISTENCE);
const shipped = tuneSettings(all, defaultParams);
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
const rangeShipped = tuneRangeSigma(test, shipped, defaultParams);
const rangeTestCoverage = [1, 2, 4, 8].map((h) =>
  rangeCoverage(test.filter((c) => c.horizon === h), { ...tunedTrend, sigmaScale: rangeCalib.rangeSigmaScale, driftPerWeek: rangeCalib.rangeDriftPerWeek }, defaultParams),
);

// Shipped settings on the test period. In-sample (they were tuned on all cases), shown for transparency only.
const shippedOnTest = {
  scores: score(probs(test, shipped), ys(test)),
  coverage80ByHorizon: [1, 2, 4, 8].map((h) => rangeCoverage(test.filter((c) => c.horizon === h), shipped, defaultParams)),
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
${settingsRow('Shipped in lib/model/params.ts (tuned on all cases)', results.shippedParams)}

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

The shipped settings were tuned on all cases, including the test period, so these numbers are optimistic: Brier ${f(shippedOnTest.scores.brier)}, log loss ${f(shippedOnTest.scores.logLoss)}, calibration error ${f(shippedOnTest.ece)}. Actual totals inside the 80% range at 1/2/4/8 weeks: ${shippedOnTest.coverage80ByHorizon.map((x) => pct(x)).join(' / ')}.

### Displayed 80% forecast range

The probability's spread is tuned for log loss, which leaves the 80% range for the 7-day total too narrow (see the coverage column above). The displayed range therefore uses its own spread, tuned for coverage. Tuned on calibration data (σ scale ${rangeCalib.rangeSigmaScale}, drift ${rangeCalib.rangeDriftPerWeek}), it covers ${rangeTestCoverage.map((x) => pct(x)).join(' / ')} of actual test-period totals at 1/2/4/8 weeks, short of 80% because 2026 is far more volatile than 2023–25. The shipped range spread is therefore tuned on the most recent 12 months (σ scale ${rangeShipped.rangeSigmaScale}, drift ${rangeShipped.rangeDriftPerWeek}). That is in-sample, so treat the displayed range as a best current estimate rather than a validated one.

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
