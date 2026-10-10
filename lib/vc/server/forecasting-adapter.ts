/**
 * INTEGRATION POINT — Engineer 2 (forecasting estimates and history).
 *
 * VC Intelligence never recomputes allocation shares or settlement; it reads
 * services through this adapter. Expected exports are listed in
 * lib/vc/README.md. Dates are normalized because services may return ISO strings.
 */
import { getMarketHistory } from "@/lib/forecasting";
import { getMarketEstimates } from "@/lib/probability";
import type { ForecastingGateway } from "../ports";
import type { EstimatePoint, MarketEstimate } from "../types";

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));
const toNullableDate = (v: Date | string | null | undefined) => (v == null ? null : toDate(v));

function normalizeEstimate(e: MarketEstimate): MarketEstimate {
  return {
    ...e,
    asOf: toDate(e.asOf),
    lastForecastAt: toNullableDate(e.lastForecastAt),
    calibratedProbability: e.calibratedProbability ?? null,
    resolution: e.resolution ? { ...e.resolution, resolvedAt: toDate(e.resolution.resolvedAt) } : null,
  };
}

export function createForecastingGateway(): ForecastingGateway {
  return {
    async getEstimates(marketIds) {
      if (marketIds.length === 0) return new Map();
      const estimates = await getMarketEstimates([...new Set(marketIds)]);
      return new Map(estimates.map((e) => [e.marketId, normalizeEstimate(e)]));
    },

    async getHistory(marketId, options) {
      const points = await getMarketHistory(marketId, options);
      return points
        .map((p): EstimatePoint => ({ ...p, at: toDate(p.at) }))
        .sort((a, b) => a.at.getTime() - b.at.getTime());
    },
  };
}
