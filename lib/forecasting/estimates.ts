// Community estimates and the opening baseline.
//
// The baseline (model) and the community estimate (forecasts) are always kept
// apart: forecasts never change the baseline, and the two are returned as
// separate fields. An estimate is only labeled a calibrated probability when a
// calibration report backs it up.

import type { EngineConfig } from './config';
import { ForecastingError } from './errors';
import type { CommunityEstimateRule, EstimateEntry } from './ports';
import type {
  Baseline,
  BaselineView,
  ConfidenceLevel,
  EstimateKind,
  EstimateView,
  Forecast,
  Market,
  MarketEstimates,
} from './types';

export type EstimateLine = 'general' | 'specialized';

/** Summary of a calibration report, used to decide how an estimate may be labeled. */
export interface CalibrationEvidence {
  line: EstimateLine;
  estimateRuleId: string;
  resolvedMarkets: number;
  expectedCalibrationError: number;
  sufficient: boolean;
}

export function formatPercent(value: number | null): string | null {
  if (value === null) return null;
  if (value > 0 && value < 0.01) return '<1%';
  if (value < 1 && value > 0.99) return '>99%';
  return `${Math.round(value * 100)}%`;
}

export function confidenceFor(forecasterCount: number, config: EngineConfig): ConfidenceLevel {
  const t = config.confidence;
  if (forecasterCount >= t.high) return 'high';
  if (forecasterCount >= t.medium) return 'medium';
  if (forecasterCount >= t.low) return 'low';
  return 'none';
}

/** True only when evidence for this exact line and rule meets the configured bar. */
export function evidenceSupportsCalibratedLabel(
  evidence: CalibrationEvidence | undefined,
  line: EstimateLine,
  ruleId: string,
  config: EngineConfig,
): boolean {
  return (
    evidence !== undefined &&
    evidence.line === line &&
    evidence.estimateRuleId === ruleId &&
    evidence.sufficient &&
    evidence.resolvedMarkets >= config.calibration.minResolvedMarkets &&
    evidence.expectedCalibrationError <= config.calibration.maxEceForCalibratedLabel
  );
}

export function labelFor(
  kind: EstimateKind | null,
  line: EstimateLine,
  calibrated: boolean,
  evidence?: CalibrationEvidence,
): string {
  const who = line === 'general' ? 'all users' : 'verified users';
  if (kind === 'market_price') {
    // Team labels (2026-10-10). "calibrated" only with supporting evidence.
    const label = `Market probability (${who})`;
    return calibrated && evidence ? `${label} · calibrated on ${evidence.resolvedMarkets} resolved markets` : label;
  }
  if (calibrated && evidence) {
    return `Community probability, ${who} (calibrated on ${evidence.resolvedMarkets} resolved markets)`;
  }
  // A credit allocation share is a separate statistic, never called a probability.
  if (kind === 'allocation_share') return `YES allocation share, ${who}`;
  return `Community estimate, ${who}`;
}

export function toEstimateEntries(forecasts: readonly Forecast[]): EstimateEntry[] {
  return forecasts.map((f) => ({
    forecastId: f.id,
    side: f.side,
    amount: f.amount,
    sequence: f.sequence,
    ...(f.fill ? { fill: f.fill } : {}),
  }));
}

/** Runs the rule and rejects anything that isn't null or a finite number in [0, 1]. */
export function computeWithRule(
  rule: CommunityEstimateRule,
  baseline: number | null,
  entries: readonly EstimateEntry[],
): number | null {
  const value = rule.compute(baseline, entries);
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ForecastingError('INVARIANT_VIOLATION', `Estimate rule "${rule.id}" returned ${String(value)}`, {
      ruleId: rule.id,
    });
  }
  return value;
}

export interface LineStats {
  value: number | null;
  forecasterCount: number;
  forecastCount: number;
  totalAmount: number;
}

export function computeLine(
  rule: CommunityEstimateRule | undefined,
  baseline: number | null,
  forecasts: readonly Forecast[],
): LineStats {
  return {
    value: rule ? computeWithRule(rule, baseline, toEstimateEntries(forecasts)) : null,
    forecasterCount: new Set(forecasts.map((f) => f.userId)).size,
    forecastCount: forecasts.length,
    totalAmount: forecasts.reduce((sum, f) => sum + f.amount, 0),
  };
}

export function verifiedOnly(forecasts: readonly Forecast[]): Forecast[] {
  return forecasts.filter((f) => f.verifiedAtEntry);
}

export function toEstimateView(
  stats: LineStats,
  line: EstimateLine,
  rule: CommunityEstimateRule | undefined,
  config: EngineConfig,
  evidence?: CalibrationEvidence,
): EstimateView {
  const calibrated =
    rule !== undefined && stats.value !== null && evidenceSupportsCalibratedLabel(evidence, line, rule.id, config);
  const view: EstimateView = {
    value: stats.value,
    display: formatPercent(stats.value),
    label: labelFor(rule?.kind ?? null, line, calibrated, evidence),
    kind: rule?.kind ?? null,
    isCalibratedProbability: calibrated,
    forecasterCount: stats.forecasterCount,
    forecastCount: stats.forecastCount,
    totalAmount: stats.totalAmount,
    confidence: confidenceFor(stats.forecasterCount, config),
  };
  if (!rule) {
    view.emptyReason = 'No pricing rule configured yet';
  } else if (stats.value === null) {
    view.emptyReason =
      stats.forecastCount === 0
        ? line === 'general'
          ? 'No forecasts yet'
          : 'No forecasts from verified users yet'
        : 'The estimate rule produced no value for these forecasts';
  }
  return view;
}

export function toBaselineView(baseline: Baseline | null, which: 'opening' | 'model'): BaselineView {
  const label = which === 'opening' ? 'Model baseline (at open)' : 'Model baseline';
  if (!baseline) {
    return {
      value: null,
      display: null,
      label,
      asOf: null,
      modelVersion: null,
      inputsNote: null,
      emptyReason: 'The model has not produced a value for this market yet',
    };
  }
  return {
    value: baseline.value,
    display: formatPercent(baseline.value),
    label,
    asOf: baseline.asOf,
    modelVersion: baseline.modelVersion,
    inputsNote: baseline.inputsNote ?? null,
  };
}

export function buildMarketEstimates(params: {
  market: Market;
  forecasts: readonly Forecast[];
  rule: CommunityEstimateRule | undefined;
  config: EngineConfig;
  asOf: Date;
  evidence?: { general?: CalibrationEvidence; specialized?: CalibrationEvidence };
}): MarketEstimates {
  const { market, forecasts, rule, config, asOf, evidence } = params;
  const baseline = market.openingBaseline?.value ?? null;
  return {
    marketId: market.id,
    asOf,
    openingBaseline: toBaselineView(market.openingBaseline, 'opening'),
    model: toBaselineView(market.model, 'model'),
    general: toEstimateView(computeLine(rule, baseline, forecasts), 'general', rule, config, evidence?.general),
    specialized: toEstimateView(
      computeLine(rule, baseline, verifiedOnly(forecasts)),
      'specialized',
      rule,
      config,
      evidence?.specialized,
    ),
  };
}

export function validateBaseline(baseline: Baseline): void {
  const { value, asOf, modelVersion } = baseline;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new ForecastingError('VALIDATION_FAILED', 'Model value must be a number in [0, 1]', { value });
  }
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    throw new ForecastingError('VALIDATION_FAILED', 'Model value needs a valid asOf date');
  }
  if (typeof modelVersion !== 'string' || modelVersion.trim() === '') {
    throw new ForecastingError('VALIDATION_FAILED', 'Model value needs a modelVersion');
  }
}
