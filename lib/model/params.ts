// Model settings. sigmaScale, driftPerWeek, levelAnchor, trendDamping and
// tailShrink are set from the backtest
// (lib/model/cli/backtest.ts); see docs/model-backtest.md for how.

export interface ModelParams {
  /** Most recent weekly totals used for the fit. */
  fitWeeks: number;
  /** Below this many usable weeks the model returns no baseline. */
  minWeeks: number;
  /** At or above this many weeks there is no shrinkage toward 50%. */
  fullWeightWeeks: number;
  /** Weight on the fitted probability at exactly minWeeks (rises linearly to 1). */
  minShrinkWeight: number;
  /** Multiplier on the residual scale when turning the fit into a forecast spread. */
  sigmaScale: number;
  /** Extra log-scale spread per sqrt(week) of horizon, for drift away from the trend. */
  driftPerWeek: number;
  /**
   * Where the forecast starts: the fitted line at the last used week ('line'),
   * or the last observed week itself ('last').
   */
  levelAnchor: 'line' | 'last';
  /** Share of the fitted weekly trend carried into the forecast (1 = full trend, 0 = flat). */
  trendDamping: number;
  /** Global pull toward 50% (and the uninformative band) to correct overconfident tails. */
  tailShrink: number;
  /** Spread settings for the displayed 80% forecast range only (calibrated for coverage). */
  rangeSigmaScale: number;
  rangeDriftPerWeek: number;
  /** Lowest residual scale allowed (log units; 0.03 ~ 3% weekly noise). */
  scaleFloor: number;
  bootstrapReplicates: number;
  /** Percentiles of the bootstrap distribution shown as the band. */
  bandQuantiles: [number, number];
  /** Band the result is pulled toward as data gets thinner. */
  uninformativeBand: [number, number];
  /**
   * A persistent step in log level larger than this (0.3 ~ a 35% jump or 26% drop)
   * is treated as a level shift: the fit restarts after it, if enough weeks follow.
   * Null disables detection.
   */
  levelShiftThreshold: number | null;
  /** Residuals beyond this many robust SDs are reported as spikes. */
  spikeThreshold: number;
}

export const MODEL_NAME = 'log-trend-theil-sen';
export const MODEL_VERSION = '1.2.0';

export const defaultParams: ModelParams = {
  fitWeeks: 16,
  minWeeks: 3,
  fullWeightWeeks: 8,
  minShrinkWeight: 0.5,
  // Tuned by the backtest on all cases (npm 2023-01 to 2026-10, PyPI last 180 days).
  sigmaScale: 1.25,
  driftPerWeek: 0.03,
  levelAnchor: 'last',
  trendDamping: 0.75,
  tailShrink: 0.05,
  // Tuned for 80% coverage on the most recent 12 months (display only).
  rangeSigmaScale: 0.5,
  rangeDriftPerWeek: 0.1,
  scaleFloor: 0.03,
  bootstrapReplicates: 500,
  bandQuantiles: [0.1, 0.9],
  uninformativeBand: [0.1, 0.9],
  spikeThreshold: 4,
  // Chosen on the backtest calibration period (see docs/model-backtest.md).
  // KNOWN ISSUE: 0.5 misses the Databricks PyPI drop; 0.4 scored the same on older
  // data. See "Known issues" in docs/model.md before changing it.
  levelShiftThreshold: 0.5,
};
