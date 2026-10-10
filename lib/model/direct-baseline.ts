import { toDayNumber } from './dates';
import { forecastWeekly, forecastTotals, probabilityAtLeast } from './forecast';
import { hashString, seedFrom } from './math';
import { defaultParams } from './params';
import { buildDailySeries, weeklySeries } from './series';
import type { DataPoint } from './types';
import type { IntakeMetric, IntakeQuestion } from './intake';

export const DIRECT_MODEL_VERSION = 'direct-metric-1.0.0';
export interface DirectBaseline {
  status: 'ok' | 'insufficient_data';
  probability: number | null;
  low: number | null;
  high: number | null;
  forecastMedian: number | null;
  asOf: string;
  modelVersion: string;
  inputsHash: string;
  inputsUsed: DataPoint[];
  excluded: { metricId: string; reason: string }[];
  notes: string[];
}

/** Same-metric forecasting only. Time coordinates are weeks; snapshot values are never summed. */
export function computeDirectBaseline(companyId: string, question: IntakeQuestion, metric: IntakeMetric, points: readonly DataPoint[], asOf: Date): DirectBaseline {
  if (question.metricId !== metric.id || !Number.isFinite(question.threshold) || question.threshold <= 0) throw new Error('Invalid target metric or threshold');
  const target = toDayNumber(question.targetDate);
  const now = asOf.getTime();
  const excluded: DirectBaseline['excluded'] = [];
  const eligible = points.filter(p => {
    if (p.companyId !== companyId) return false;
    let reason = '';
    if (p.metricId !== question.metricId) reason = 'Context only: does not match the question metric';
    else if (!Number.isFinite(Date.parse(p.availableAt)) || Date.parse(p.availableAt) > now || Date.parse(`${p.periodEnd}T23:59:59.999Z`) > now) reason = 'Not yet available at the forecast cutoff';
    else if (!Number.isFinite(p.value) || p.value < 0) reason = 'Invalid value';
    else if (toDayNumber(p.periodEnd) >= target) reason = 'Observation is on or after the target date';
    else if (metric.kind === 'snapshot' && p.periodStart !== p.periodEnd) reason = 'Snapshot metrics require a single as-of date';
    else if (metric.kind === 'weekly_total' && p.provenance === 'sponsor_provided' && toDayNumber(p.periodEnd) - toDayNumber(p.periodStart) !== 6) reason = 'Download observations must cover exactly seven days';
    if (reason) { excluded.push({ metricId: p.metricId, reason }); return false; }
    return true;
  });
  const notes = ['Only history of the target metric affects this estimate. Sponsor entries never resolve an outcome.'];
  let used: DataPoint[] = [];
  let weeks: { t: number; windowEnd: string; total: number | null }[] = [];
  if (metric.kind === 'snapshot') {
    const byDate = new Map<string, DataPoint>();
    for (const p of [...eligible].sort((a,b) => a.availableAt.localeCompare(b.availableAt))) {
      const prev = byDate.get(p.periodEnd);
      if (prev?.provenance === 'scraped' && p.provenance === 'sponsor_provided') continue;
      byDate.set(p.periodEnd, p);
    }
    used = [...byDate.values()].sort((a,b) => a.periodEnd.localeCompare(b.periodEnd)).slice(-16);
    for (const p of eligible) {
      const chosen = byDate.get(p.periodEnd);
      if (p.provenance === 'sponsor_provided' && chosen?.provenance === 'scraped' && chosen.value !== p.value) notes.push(`Public data takes precedence on ${p.periodEnd}; sponsor value differs.`);
    }
    weeks = used.map(p => ({ t: (toDayNumber(p.periodEnd) - target) / 7, windowEnd: p.periodEnd, total: p.value }));
    notes.push('Snapshot forecasts are experimental; download backtests do not validate revenue or user-count forecasts.');
  } else {
    const scraped = eligible.filter(p => p.provenance === 'scraped' && p.periodStart === p.periodEnd);
    const daily = buildDailySeries(scraped, metric.id, asOf);
    const publicWeeks = weeklySeries(daily, question.targetDate, 16).weeks;
    const totals = new Map(publicWeeks.filter(w => w.total !== null).map(w => [w.windowEnd, w]));
    const sponsors = new Map<string, DataPoint>();
    for (const p of [...eligible].sort((a,b) => a.availableAt.localeCompare(b.availableAt))) {
      if (p.provenance !== 'sponsor_provided') continue;
      if ((target - toDayNumber(p.periodEnd)) % 7 !== 0) { excluded.push({ metricId: p.metricId, reason: `Week ending ${p.periodEnd} does not align with the target window` }); continue; }
      if (totals.has(p.periodEnd)) {
        notes.push(`Public data takes precedence for the week ending ${p.periodEnd}${totals.get(p.periodEnd)!.total !== p.value ? '; sponsor value differs' : ''}.`);
        continue;
      }
      sponsors.set(p.periodEnd, p);
    }
    for (const p of sponsors.values()) totals.set(p.periodEnd, { t: (toDayNumber(p.periodEnd)-target)/7, windowEnd: p.periodEnd, total: p.value });
    weeks = [...totals.values()].sort((a,b) => a.t-b.t).slice(-16);
    const ends = new Set(weeks.map(w => w.windowEnd));
    used = [...sponsors.values()].filter(p => ends.has(p.periodEnd));
    used.push(...scraped.filter(p => weeks.some(w => !sponsors.has(w.windowEnd) && toDayNumber(p.periodEnd) <= toDayNumber(w.windowEnd) && toDayNumber(p.periodEnd) >= toDayNumber(w.windowEnd)-6)));
  }
  // A month of history prevents many adjacent snapshots from masquerading as a trend.
  const span = weeks.length ? toDayNumber(weeks.at(-1)!.windowEnd)-toDayNumber(weeks[0]!.windowEnd) : 0;
  // JSONB changes object-key order. Hash explicit tuples so a database round
  // trip cannot change either the fingerprint or the bootstrap seed.
  const inputTuples = used.map(p => [p.companyId, p.metricId, p.source, p.value, p.periodStart, p.periodEnd, p.availableAt, p.fetchedAt, p.sourceUrl, p.provenance, p.simulated, p.note ?? null]);
  const inputsHash = hashString(JSON.stringify([DIRECT_MODEL_VERSION, [question.metricId, question.threshold, question.targetDate], metric.kind, defaultParams, inputTuples]));
  const base: DirectBaseline = { status: 'insufficient_data', probability: null, low: null, high: null, forecastMedian: null, asOf: asOf.toISOString(), modelVersion: DIRECT_MODEL_VERSION, inputsHash, inputsUsed: used, excluded, notes };
  if (target <= Math.floor(now/86400000)) { notes.push('Choose a future target date.'); return base; }
  if (weeks.length < 3 || (metric.kind === 'snapshot' && span < 28)) {
    notes.push(metric.kind === 'snapshot' ? 'Provide at least three dated observations spanning at least 28 days.' : 'Provide at least three complete, aligned seven-day totals.');
    return base;
  }
  const fit = forecastWeekly({ weeks, horizonWeeks: -weeks.at(-1)!.t }, defaultParams, seedFrom(inputsHash));
  if (fit.status !== 'ok') { notes.push('Insufficient history after data-quality checks.'); return base; }
  if (fit.levelShift?.applied) notes.push(`A level shift was detected; the trend starts at ${fit.levelShift.firstWeekAfter}.`);
  if (fit.spikes.length) notes.push(`Unusual observations were down-weighted: ${fit.spikes.join(', ')}.`);
  const probability = probabilityAtLeast(fit, question.threshold, defaultParams);
  const forecastMedian = forecastTotals(fit.mu!, fit.sigma!).median;
  if (![probability.probability, probability.low, probability.high, forecastMedian].every(Number.isFinite)) { notes.push('Forecast exceeded the supported numeric range.'); return base; }
  if (used.some(p => p.simulated)) notes.push('Includes SIMULATED sponsor data.');
  if (used.some(p => p.provenance === 'sponsor_provided')) notes.push('Includes unverified sponsor-provided history.');
  if (weeks.length < 8) notes.push('Limited history: estimate is pulled toward 50%.');
  return { ...base, status: 'ok', probability: probability.probability, low: probability.low, high: probability.high, forecastMedian };
}
