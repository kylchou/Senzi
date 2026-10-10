// Facade wiring the engine's services to their dependencies.

import {
  getCalibrationEvidence,
  getCalibrationReport,
  getLeaderboard,
  getUserStats,
  type CalibrationLine,
  type LeaderboardMetric,
} from './analytics.js';
import { mergeConfig, type EngineConfig } from './config.js';
import type { EngineDeps } from './deps.js';
import { ForecastingError } from './errors.js';
import { buildMarketEstimates } from './estimates.js';
import { selectHistory, snapshotsToCsv, toChartSeries, type HistoryQuery } from './history.js';
import { recordModelValue } from './model-updates.js';
import { getPortfolio } from './portfolio.js';
import { settleMarket, type SettleMarketInput } from './settlement.js';
import { quoteForecast, submitForecast, type SubmitForecastInput } from './submission.js';
import type { AuthContext } from './ports.js';
import type { Baseline } from './types.js';

export type EngineOptions = Omit<EngineDeps, 'config'> & { config?: Partial<EngineConfig> };

export function createForecastingEngine(options: EngineOptions) {
  const deps: EngineDeps = { ...options, config: mergeConfig(options.config) };

  async function requireMarket(marketId: string) {
    const market = await deps.repo.getMarket(marketId);
    if (!market) throw new ForecastingError('MARKET_NOT_FOUND', 'Market not found', { marketId });
    return market;
  }

  return {
    config: deps.config,

    // 1. Forecast submission
    submitForecast: (auth: AuthContext, input: SubmitForecastInput) => submitForecast(deps, auth, input),
    quoteForecast: (input: { marketId: string; side: 'YES' | 'NO'; amount: number }) => quoteForecast(deps, input),

    // 2. Probability calculations: baseline and community estimates, kept apart
    async getMarketEstimates(marketId: string) {
      const market = await requireMarket(marketId);
      const [forecasts, general, specialized] = await Promise.all([
        deps.repo.listForecastsByMarket(marketId),
        getCalibrationEvidence(deps, 'general'),
        getCalibrationEvidence(deps, 'specialized'),
      ]);
      return buildMarketEstimates({
        market,
        forecasts,
        rule: deps.estimateRule,
        config: deps.config,
        asOf: deps.clock.now(),
        evidence: { ...(general ? { general } : {}), ...(specialized ? { specialized } : {}) },
      });
    },
    recordModelValue: (auth: AuthContext, marketId: string, value: Baseline) =>
      recordModelValue(deps, auth, marketId, value),

    // 3. Forecast history
    async getHistory(marketId: string, query?: HistoryQuery) {
      await requireMarket(marketId);
      return selectHistory(await deps.repo.listSnapshots(marketId), query);
    },
    async getChartSeries(marketId: string, query?: HistoryQuery) {
      await requireMarket(marketId);
      return toChartSeries(marketId, selectHistory(await deps.repo.listSnapshots(marketId), query));
    },
    async exportHistoryCsv(marketId: string, query?: HistoryQuery) {
      await requireMarket(marketId);
      return snapshotsToCsv(selectHistory(await deps.repo.listSnapshots(marketId), query));
    },

    // 4. Virtual portfolio
    getPortfolio: (auth: AuthContext, userId: string) => getPortfolio(deps, auth, userId),

    // 5. Performance analytics
    getUserStats: (userId: string) => getUserStats(deps, userId),
    getLeaderboard: (options?: { metric?: LeaderboardMetric; limit?: number }) => getLeaderboard(deps, options),
    getCalibrationReport: (line: CalibrationLine) => getCalibrationReport(deps, line),

    // 6. Market settlement
    settleMarket: (auth: AuthContext, input: SettleMarketInput) => settleMarket(deps, auth, input),
  };
}

export type ForecastingEngine = ReturnType<typeof createForecastingEngine>;
