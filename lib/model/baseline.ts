// computeBaseline: the pure function behind getBaseline.
//
// Inputs are the question, every stored data point, optional sponsor-provided
// points and an as-of time. Sponsor points only matter when they measure the
// question's own metric; then they fill weeks that scraped data is missing
// (scraped data always wins where both exist). Anything else a sponsor supplies
// is display-only and cannot change the number.

import { fromDayNumber, toDayNumber } from './dates.js';
import { forecastSigma, forecastTotals, forecastWeekly, probabilityAtLeast } from './forecast.js';
import { hashString, seedFrom } from './math.js';
import { defaultParams, MODEL_NAME, MODEL_VERSION, type ModelParams } from './params.js';
import { buildDailySeries, weeklySeries, windowTotal } from './series.js';
import type {
  BaselineResult,
  DataPoint,
  InputUsed,
  MethodInfo,
  ModelConfidence,
  SourceRef,
  ThresholdQuestion,
} from './types.js';

export const METHOD_DESCRIPTION =
  'Fits a straight-line trend to log(1 + weekly total) over the most recent weeks (Theil–Sen, robust to spikes), ' +
  'projects it from the last complete week to the question window, and converts the distance to the threshold into a probability using a normal ' +
  'distribution: p = 1 − Φ((ln(1+T) − μ) / σ). The trend is damped and the result is pulled slightly toward 50% ' +
  '(settings chosen by backtest), so it never reaches 0% or 100%. A persistent jump or drop in level (e.g. a change in how ' +
  'downloads are counted) restarts the fit after the jump. With fewer than 8 weeks of data the result is pulled further toward 50% and ' +
  'the band widens. The band is model uncertainty (10th–90th percentile across refits on resampled data), not a range ' +
  'for the outcome. Trades never feed the model.';

export interface BaselineOptions {
  params?: ModelParams;
  sponsorPoints?: readonly DataPoint[];
}

function emptyMethod(inputsHash: string, params: ModelParams): MethodInfo {
  return {
    name: MODEL_NAME,
    version: MODEL_VERSION,
    description: METHOD_DESCRIPTION,
    details: {
      dataThrough: null,
      weeksUsed: 0,
      horizonWeeks: null,
      weeklyGrowth: null,
      forecastMedian: null,
      forecastRange80: null,
      lastObservedWeek: null,
      mu: null,
      sigma: null,
      rawProbability: null,
      shrinkWeight: null,
      tailShrink: params.tailShrink,
      bootstrapReplicates: params.bootstrapReplicates,
      seed: null,
      inputsHash,
    },
  };
}

export function confidenceFor(input: {
  weeksUsed: number;
  horizonWeeks: number;
  bandWidth: number;
  missingWeeks: number;
  recentSpike: boolean;
  params: ModelParams;
}): ModelConfidence {
  if (input.weeksUsed < input.params.fullWeightWeeks || input.bandWidth > 0.5 || input.recentSpike) return 'low';
  if (input.weeksUsed >= 12 && input.horizonWeeks <= 4 && input.bandWidth <= 0.25 && input.missingWeeks === 0) return 'high';
  return 'medium';
}

export function computeBaseline(
  question: ThresholdQuestion,
  points: readonly DataPoint[],
  asOf: Date,
  options: BaselineOptions = {},
): BaselineResult {
  const params = options.params ?? defaultParams;
  const series = buildDailySeries(points, question.metricId, asOf);
  const targetEnd = toDayNumber(question.windowEnd);

  // Only sponsor points for the question's own metric, available by asOf, are considered.
  const sponsor = (options.sponsorPoints ?? []).filter(
    (p) =>
      p.provenance === 'sponsor_provided' &&
      p.metricId === question.metricId &&
      p.companyId === question.companyId &&
      Date.parse(p.availableAt) <= asOf.getTime() &&
      toDayNumber(p.periodEnd) - toDayNumber(p.periodStart) === 6,
  );

  const weekly = weeklySeries(series, question.windowEnd, params.fitWeeks);
  const sponsorByWeek = new Map<string, DataPoint>();
  for (const p of sponsor) {
    const scraped = weekly.weeks.find((w) => w.windowEnd === p.periodEnd);
    if (scraped && scraped.total === null) sponsorByWeek.set(p.periodEnd, p);
  }
  const sponsorTotals = new Map([...sponsorByWeek].map(([k, p]) => [k, p.value]));

  const weeklyKey = weekly.weeks.map((w) => `${w.windowEnd}:${w.total ?? sponsorTotals.get(w.windowEnd) ?? '-'}`).join(',');
  const inputsHash = hashString(
    [MODEL_VERSION, JSON.stringify(params), question.id, question.metricId, question.threshold, question.windowEnd, weeklyKey].join('|'),
  );

  const sources: SourceRef[] = series.sourceUrls.slice(0, 5).map((url) => ({
    source: question.resolutionSource.source,
    url,
    fetchedAt: series.latestFetchedAt,
  }));
  const notes: string[] = [];
  const missing: string[] = [];
  if (series.zeroDaysTreatedAsMissing.length) {
    notes.push(`Reported zero on ${series.zeroDaysTreatedAsMissing.join(', ')} treated as missing (implausible for this series).`);
  }

  const base = {
    questionId: question.id,
    questionText: question.text,
    bandLabel: 'model uncertainty' as const,
    asOf: asOf.toISOString(),
    sources,
    notes,
    missing,
  };
  const dataThrough = series.lastDay === null ? null : fromDayNumber(series.lastDay);

  if (series.lastDay === null) {
    missing.push(`No ${question.metricId} data available as of ${base.asOf}.`);
    return { ...base, status: 'insufficient_data', probability: null, low: null, high: null, confidence: null, method: emptyMethod(inputsHash, params), inputsUsed: [] };
  }

  const trendInput: InputUsed = {
    metricId: question.metricId,
    source: question.resolutionSource.source,
    provenance: 'scraped',
    simulated: false,
    role: 'trend',
    points: series.points,
    periodStart: fromDayNumber(series.firstDay!),
    periodEnd: dataThrough,
  };

  // Target window already fully reported: the answer is known.
  if (series.lastDay >= targetEnd) {
    const total = windowTotal(series, targetEnd);
    if (total !== null) {
      const p = total >= question.threshold ? 1 : 0;
      const method = emptyMethod(inputsHash, params);
      method.details.dataThrough = dataThrough;
      method.details.lastObservedWeek = { windowEnd: question.windowEnd, total };
      notes.push(`The question window is already reported: ${total.toLocaleString('en-US')} vs threshold ${question.threshold.toLocaleString('en-US')}.`);
      return { ...base, status: 'observed', probability: p, low: p, high: p, confidence: 'high', method, inputsUsed: [trendInput] };
    }
    notes.push('The question window has ended but some of its days are missing; forecasting from earlier weeks.');
  } else if (series.lastDay > targetEnd - 7) {
    notes.push('Part of the question window is already reported; the model uses whole weeks before it.');
  }

  const seed = seedFrom(question.id, inputsHash);
  const fc = forecastWeekly(weekly, params, seed, sponsorTotals);
  if (fc.missingWeeks.length) missing.push(`Incomplete weeks left out of the fit: ${fc.missingWeeks.join(', ')}.`);

  const inputsUsed: InputUsed[] = [trendInput];
  if (sponsorByWeek.size) {
    const ends = [...sponsorByWeek.keys()].sort();
    inputsUsed.push({
      metricId: question.metricId,
      source: 'sponsor',
      provenance: 'sponsor_provided',
      simulated: [...sponsorByWeek.values()].some((p) => p.simulated),
      role: 'sponsor_fill',
      points: sponsorByWeek.size,
      periodStart: ends[0]!,
      periodEnd: ends[ends.length - 1]!,
    });
    notes.push(`Sponsor-provided totals filled ${sponsorByWeek.size} week(s) missing from scraped data.`);
  }

  if (fc.status !== 'ok') {
    missing.push(
      `Only ${fc.used.length} complete week(s) of data before the question window; at least ${params.minWeeks} are needed.`,
    );
    const method = emptyMethod(inputsHash, params);
    method.details.dataThrough = dataThrough;
    method.details.weeksUsed = fc.used.length;
    method.details.horizonWeeks = fc.horizonWeeks;
    return { ...base, status: 'insufficient_data', probability: null, low: null, high: null, confidence: null, method, inputsUsed };
  }

  const prob = probabilityAtLeast(fc, question.threshold, params);
  const rangeSigma = forecastSigma(fc.fit!.scale, fc.fit!, fc.horizonWeeks, {
    ...params,
    sigmaScale: params.rangeSigmaScale,
    driftPerWeek: params.rangeDriftPerWeek,
  });
  const totals = forecastTotals(fc.mu!, rangeSigma);
  const last = fc.used[fc.used.length - 1]!;
  const recentSpike = fc.spikes.some((s) => toDayNumber(s) >= toDayNumber(last.windowEnd) - 7);
  if (fc.levelShift) {
    const pctChange = `${fc.levelShift.change > 0 ? '+' : ''}${(fc.levelShift.change * 100).toFixed(0)}%`;
    notes.push(
      fc.levelShift.applied
        ? `Level shift of ${pctChange} in the week ending ${fc.levelShift.firstWeekAfter}; the trend is fitted only on the weeks since.`
        : `Possible level shift of ${pctChange} in the week ending ${fc.levelShift.firstWeekAfter}; too few weeks since to refit, so the full window is used.`,
    );
  }
  if (fc.spikes.length) notes.push(`Unusual weeks (down-weighted by the robust fit): ${fc.spikes.join(', ')}.`);
  if (params.levelAnchor === 'last' && fc.anchorUsed === 'line') {
    notes.push('The latest week looks unusual, so the forecast starts from the trend line instead of that week.');
  }
  if (fc.used.length < params.fullWeightWeeks) {
    notes.push(`Only ${fc.used.length} weeks of data: probability pulled toward 50% and band widened.`);
  }
  if (fc.horizonWeeks > 8) notes.push(`Forecasting ${fc.horizonWeeks} weeks ahead; long horizons are less reliable.`);

  return {
    ...base,
    status: 'ok',
    probability: prob.probability,
    low: prob.low,
    high: prob.high,
    confidence: confidenceFor({
      weeksUsed: fc.used.length,
      horizonWeeks: fc.horizonWeeks,
      bandWidth: prob.high - prob.low,
      missingWeeks: fc.missingWeeks.length,
      recentSpike,
      params,
    }),
    method: {
      name: MODEL_NAME,
      version: MODEL_VERSION,
      description: METHOD_DESCRIPTION,
      details: {
        dataThrough,
        weeksUsed: fc.used.length,
        horizonWeeks: fc.horizonWeeks,
        weeklyGrowth: Math.expm1(fc.fit!.slope),
        forecastMedian: totals.median,
        forecastRange80: totals.range80,
        lastObservedWeek: { windowEnd: last.windowEnd, total: last.total },
        mu: fc.mu,
        sigma: fc.sigma,
        rawProbability: prob.rawProbability,
        shrinkWeight: fc.shrinkWeight,
        tailShrink: params.tailShrink,
        bootstrapReplicates: params.bootstrapReplicates,
        seed,
        inputsHash,
      },
    },
    inputsUsed,
  };
}
