// Tunable settings. Defaults are placeholders chosen for "dozens of forecasters
// per question", not values the team has agreed on.

export interface EngineConfig {
  /** Default per-forecast limits (credits, inclusive) when a market doesn't set its own. */
  defaultMinAmount: number;
  defaultMaxAmount: number;
  /** Idempotency keys are client-generated; cap their length. */
  maxIdempotencyKeyLength: number;
  /** Distinct-forecaster thresholds for the confidence label shown next to every estimate. */
  confidence: { low: number; medium: number; high: number };
  calibration: {
    /** Minimum resolved (non-void) markets before a calibration report is called sufficient. */
    minResolvedMarkets: number;
    /** Expected calibration error at or below which an estimate may be labeled calibrated. */
    maxEceForCalibratedLabel: number;
    bins: number;
  };
  leaderboard: {
    /** Minimum resolved forecasts before a user is ranked on accuracy. */
    minResolvedForAccuracyRank: number;
  };
  /**
   * When true, only verified users of the company's product may forecast at all.
   * The spec is inconsistent here (Product says verified-only; the three-chart
   * design has a general line open to any signed-up user), so this stays a switch.
   */
  requireVerifiedTrader: boolean;
  /** Display name for the unit. Token vs credit naming is still open. */
  unitLabel: string;
}

export const defaultConfig: EngineConfig = {
  defaultMinAmount: 1,
  defaultMaxAmount: 10_000,
  maxIdempotencyKeyLength: 128,
  confidence: { low: 1, medium: 10, high: 30 },
  calibration: { minResolvedMarkets: 30, maxEceForCalibratedLabel: 0.05, bins: 10 },
  leaderboard: { minResolvedForAccuracyRank: 5 },
  requireVerifiedTrader: false,
  unitLabel: 'credits',
};

export function mergeConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    ...defaultConfig,
    ...overrides,
    confidence: { ...defaultConfig.confidence, ...overrides.confidence },
    calibration: { ...defaultConfig.calibration, ...overrides.calibration },
    leaderboard: { ...defaultConfig.leaderboard, ...overrides.leaderboard },
  };
}
