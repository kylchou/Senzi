/**
 * INTEGRATION POINT (forecasting estimates and history).
 *
 * VC Intelligence never recomputes forecasts or settlement. It reads the
 * aggregates the forecasting engine maintains on Market and MarketSnapshot,
 * plus the Resolution record, as described in docs/API.md. When the engine
 * exposes read services, this file is the one place to switch over.
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { SnapshotTrigger } from "@/generated/prisma/enums";
import type { ForecastingGateway } from "../ports";
import type { EstimatePoint, MarketEstimate } from "../types";

/** Community YES credit-allocation share: YES credits / total credits, or null for an empty market. */
const share = (yes: number, no: number) => (yes + no > 0 ? yes / (yes + no) : null);

export function createForecastingGateway(db: PrismaClient): ForecastingGateway {
  return {
    async getEstimates(marketIds) {
      const ids = [...new Set(marketIds)];
      if (ids.length === 0) return new Map();
      const [markets, lastForecasts] = await Promise.all([
        db.market.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            status: true,
            openingBaseline: true,
            baselineMethodology: true,
            yesCredits: true,
            noCredits: true,
            forecastCount: true,
            updatedAt: true,
            snapshots: {
              orderBy: { sequence: "desc" },
              take: 1,
              select: { recordedAt: true, forecasterCount: true, calibratedProbability: true },
            },
            resolution: { select: { outcome: true, resolvedAt: true, evidenceSummary: true, evidenceUrls: true } },
          },
        }),
        db.marketSnapshot.groupBy({
          by: ["marketId"],
          where: { marketId: { in: ids }, trigger: SnapshotTrigger.FORECAST },
          _max: { recordedAt: true },
        }),
      ]);
      const lastForecastAt = new Map(lastForecasts.map((r) => [r.marketId, r._max.recordedAt]));

      return new Map(
        markets.map((m): [string, MarketEstimate] => {
          const latest = m.snapshots[0];
          return [
            m.id,
            {
              marketId: m.id,
              status: m.status,
              openingBaseline:
                m.openingBaseline != null ? { value: m.openingBaseline, methodology: m.baselineMethodology } : null,
              allocation: {
                yesCredits: m.yesCredits,
                noCredits: m.noCredits,
                totalCredits: m.yesCredits + m.noCredits,
                yesShare: share(m.yesCredits, m.noCredits),
              },
              calibratedProbability:
                latest?.calibratedProbability != null
                  ? { value: latest.calibratedProbability, method: null, sampleSize: null }
                  : null,
              participantCount: latest?.forecasterCount ?? 0,
              forecastCount: m.forecastCount,
              lastForecastAt: lastForecastAt.get(m.id) ?? null,
              asOf: latest?.recordedAt ?? m.updatedAt,
              resolution: m.resolution
                ? {
                    outcome: m.resolution.outcome,
                    resolvedAt: m.resolution.resolvedAt,
                    evidenceSummary: m.resolution.evidenceSummary,
                    evidenceUrls: m.resolution.evidenceUrls,
                  }
                : null,
            },
          ];
        }),
      );
    },

    async getHistory(marketId, options): Promise<EstimatePoint[]> {
      const rows = await db.marketSnapshot.findMany({
        where: {
          marketId,
          ...((options?.from || options?.to) && { recordedAt: { gte: options?.from, lte: options?.to } }),
        },
        orderBy: { sequence: "asc" },
        select: { id: true, recordedAt: true, allocationShare: true, yesCredits: true, noCredits: true, forecasterCount: true },
      });
      return rows.map((r) => ({
        id: r.id,
        at: r.recordedAt,
        yesShare: r.allocationShare,
        totalCredits: r.yesCredits + r.noCredits,
        participantCount: r.forecasterCount,
      }));
    },
  };
}
