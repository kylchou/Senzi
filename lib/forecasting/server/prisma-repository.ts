import "server-only";

// ForecastRepository and LockManager on Ky's Prisma schema (docs/API.md,
// "Felix: forecasting and settlement"). Every method uses the transaction
// client it was built with, so a forecast, its ledger debit and its snapshot
// commit or roll back together.

import type { Prisma } from "@/generated/prisma/client";
import {
  EstimateKind,
  ForecastStatus,
  MarketStatus as DbMarketStatus,
  SnapshotTrigger,
} from "@/generated/prisma/enums";
import type { TxClient } from "@/lib/db";
import { SIGNUP_GRANT_CREDITS } from "@/lib/types";
import { liquidityFor } from "../lmsr";
import type { ForecastRepository, LockManager } from "../ports";
import type {
  EntrySnapshot,
  EstimateKind as EngineEstimateKind,
  Forecast,
  Market,
  MarketSnapshot,
  MarketStatus,
  SettlementRecord,
  SnapshotTrigger as EngineTrigger,
} from "../types";

const STATUS: Record<DbMarketStatus, MarketStatus> = {
  DRAFT: "draft",
  OPEN: "open",
  CLOSED: "closed",
  RESOLVED: "resolved",
  CANCELLED: "cancelled",
};

const TRIGGER_TO_DB: Record<EngineTrigger, SnapshotTrigger> = {
  forecast: SnapshotTrigger.FORECAST,
  model_update: SnapshotTrigger.MODEL_UPDATE,
  settlement: SnapshotTrigger.SETTLEMENT,
};

const TRIGGER_FROM_DB: Record<SnapshotTrigger, EngineTrigger | "opening"> = {
  OPENING: "opening",
  FORECAST: "forecast",
  MODEL_UPDATE: "model_update",
  SETTLEMENT: "settlement",
};

const KIND_TO_DB: Record<EngineEstimateKind, EstimateKind> = {
  allocation_share: EstimateKind.ALLOCATION_SHARE,
  market_price: EstimateKind.MARKET_PRICE,
};

const KIND_FROM_DB: Record<EstimateKind, EngineEstimateKind> = {
  ALLOCATION_SHARE: "allocation_share",
  MARKET_PRICE: "market_price",
};

const marketSelect = {
  id: true,
  startupId: true,
  question: true,
  createdById: true,
  status: true,
  opensAt: true,
  closesAt: true,
  openingBaseline: true,
  baselineSetAt: true,
  baselineMethodology: true,
  modelValue: true,
  modelVersion: true,
  modelInputsNote: true,
  modelUpdatedAt: true,
  minForecastCredits: true,
  maxForecastCredits: true,
  verifiedUsersOnly: true,
  createdAt: true,
  modelBaselineSnapshots: { orderBy: { createdAt: "desc" }, take: 1, select: { confidence: true } },
} satisfies Prisma.MarketSelect;

type MarketRow = Prisma.MarketGetPayload<{ select: typeof marketSelect }>;

/**
 * LMSR liquidity before a market's first trade: b scales with the signup
 * grant and is lower when the model marked its baseline low-confidence. The
 * first trade freezes it in the forecast's fill.
 */
export function lmsrBFor(row: Pick<MarketRow, "modelBaselineSnapshots">): number {
  return liquidityFor({
    startingBalance: SIGNUP_GRANT_CREDITS,
    lowConfidence: row.modelBaselineSnapshots[0]?.confidence === "low",
  });
}

function toMarket(row: MarketRow): Market {
  const at = (d: Date | null) => d ?? row.createdAt;
  return {
    id: row.id,
    companyId: row.startupId,
    question: row.question,
    // Organization (sponsor) membership is checked separately in the service.
    sponsorId: row.createdById ?? "",
    status: STATUS[row.status],
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    openingBaseline:
      row.openingBaseline === null
        ? null
        : {
            value: row.openingBaseline,
            asOf: at(row.baselineSetAt),
            modelVersion: row.modelVersion ?? "admin",
            ...(row.baselineMethodology ? { inputsNote: row.baselineMethodology } : {}),
          },
    model:
      row.modelValue === null
        ? null
        : {
            value: row.modelValue,
            asOf: at(row.modelUpdatedAt),
            modelVersion: row.modelVersion ?? "unknown",
            ...(row.modelInputsNote ? { inputsNote: row.modelInputsNote } : {}),
          },
    ...(row.minForecastCredits !== null ? { minAmount: row.minForecastCredits } : {}),
    ...(row.maxForecastCredits !== null ? { maxAmount: row.maxForecastCredits } : {}),
    lmsrB: lmsrBFor(row),
    ...(row.verifiedUsersOnly ? { verifiedUsersOnly: true } : {}),
    createdAt: row.createdAt,
  };
}

// Entry is stored as JSON: dates as ISO strings, plus the ledger transaction id
// (the Forecast table has no column for it).
type StoredEntry = Omit<EntrySnapshot, "modelAsOf"> & { modelAsOf: string | null; ledgerTransactionId: string };

function toForecast(row: Prisma.ForecastGetPayload<object>): Forecast {
  const stored = row.entry as unknown as Partial<StoredEntry>;
  const { ledgerTransactionId = "", modelAsOf = null, ...entry } = stored;
  return {
    id: row.id,
    marketId: row.marketId,
    userId: row.userId,
    side: row.side,
    amount: row.credits,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    sequence: row.sequence,
    acceptedAt: row.createdAt,
    verifiedAtEntry: row.verifiedAtEntry,
    ledgerTransactionId,
    entry: { ...(entry as EntrySnapshot), modelAsOf: modelAsOf ? new Date(modelAsOf) : null },
    ...(row.fill ? { fill: row.fill as Record<string, number> } : {}),
  };
}

function toSnapshot(row: Prisma.MarketSnapshotGetPayload<object>): MarketSnapshot {
  const trigger = TRIGGER_FROM_DB[row.trigger];
  return {
    marketId: row.marketId,
    sequence: row.sequence,
    at: row.recordedAt,
    // The opening point is written by Ky's market creation; the engine treats it as a model value.
    trigger: trigger === "opening" ? "model_update" : trigger,
    ...(row.forecastId ? { forecastId: row.forecastId } : {}),
    openingBaseline: row.openingBaseline,
    model: row.modelValue,
    general: row.generalEstimate,
    specialized: row.specializedEstimate,
    generalForecasters: row.forecasterCount,
    specializedForecasters: row.specializedForecasters,
    generalAmount: row.yesCredits + row.noCredits,
    specializedAmount: row.specializedCredits,
    estimateRuleId: row.estimateRuleId,
    estimateKind: row.estimateKind ? KIND_FROM_DB[row.estimateKind] : null,
  };
}

export class PrismaForecastRepository implements ForecastRepository {
  constructor(private readonly tx: TxClient) {}

  async getMarket(marketId: string) {
    const row = await this.tx.market.findUnique({ where: { id: marketId }, select: marketSelect });
    return row ? toMarket(row) : null;
  }

  /** Writes only what the engine owns: the opening baseline and model fields. Ky's code owns the lifecycle status. */
  async saveMarket(market: Market) {
    await this.tx.market.update({
      where: { id: market.id },
      data: {
        openingBaseline: market.openingBaseline?.value ?? null,
        baselineSetAt: market.openingBaseline?.asOf ?? null,
        modelValue: market.model?.value ?? null,
        modelVersion: market.model?.modelVersion ?? null,
        modelInputsNote: market.model?.inputsNote ?? null,
        modelUpdatedAt: market.model?.asOf ?? null,
      },
    });
  }

  async listMarkets() {
    const rows = await this.tx.market.findMany({ select: marketSelect });
    return rows.map(toMarket);
  }

  async findForecastByIdempotencyKey(userId: string, idempotencyKey: string) {
    const row = await this.tx.forecast.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey } } });
    return row ? toForecast(row) : null;
  }

  async recordForecast(forecast: Forecast, snapshot: MarketSnapshot) {
    const entry: StoredEntry = {
      ...forecast.entry,
      modelAsOf: forecast.entry.modelAsOf ? forecast.entry.modelAsOf.toISOString() : null,
      ledgerTransactionId: forecast.ledgerTransactionId,
    };
    await this.tx.forecast.create({
      data: {
        id: forecast.id,
        userId: forecast.userId,
        marketId: forecast.marketId,
        sequence: forecast.sequence,
        side: forecast.side,
        credits: forecast.amount,
        idempotencyKey: forecast.idempotencyKey,
        requestHash: forecast.requestHash,
        verifiedAtEntry: forecast.verifiedAtEntry,
        entry: entry as unknown as Prisma.InputJsonValue,
        ...(forecast.fill ? { fill: forecast.fill as Prisma.InputJsonValue } : {}),
        status: ForecastStatus.ACTIVE,
        createdAt: forecast.acceptedAt,
      },
    });
    // Aggregates Ky's schema keeps on Market, updated in the same transaction.
    await this.tx.market.update({
      where: { id: forecast.marketId },
      data: {
        ...(forecast.side === "YES" ? { yesCredits: { increment: forecast.amount } } : { noCredits: { increment: forecast.amount } }),
        forecastCount: { increment: 1 },
      },
    });
    await this.appendSnapshot(snapshot);
  }

  async listForecastsByMarket(marketId: string) {
    const rows = await this.tx.forecast.findMany({ where: { marketId }, orderBy: { sequence: "asc" } });
    return rows.map(toForecast);
  }

  async listForecastsByUser(userId: string) {
    const rows = await this.tx.forecast.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    return rows.map(toForecast);
  }

  async appendSnapshot(snapshot: MarketSnapshot) {
    const market = await this.tx.market.findUniqueOrThrow({
      where: { id: snapshot.marketId },
      select: { yesCredits: true, noCredits: true, forecastCount: true },
    });
    const total = market.yesCredits + market.noCredits;
    await this.tx.marketSnapshot.create({
      data: {
        marketId: snapshot.marketId,
        sequence: snapshot.sequence,
        trigger: TRIGGER_TO_DB[snapshot.trigger],
        forecastId: snapshot.forecastId ?? null,
        openingBaseline: snapshot.openingBaseline,
        modelValue: snapshot.model,
        yesCredits: market.yesCredits,
        noCredits: market.noCredits,
        // A separate allocation statistic, kept apart from the LMSR price.
        allocationShare: total > 0 ? market.yesCredits / total : null,
        generalEstimate: snapshot.general,
        specializedEstimate: snapshot.specialized,
        estimateRuleId: snapshot.estimateRuleId,
        estimateKind: snapshot.estimateKind ? KIND_TO_DB[snapshot.estimateKind] : null,
        forecastCount: market.forecastCount,
        forecasterCount: snapshot.generalForecasters,
        specializedForecasters: snapshot.specializedForecasters,
        specializedCredits: snapshot.specializedAmount,
        recordedAt: snapshot.at,
      },
    });
  }

  async listSnapshots(marketId: string) {
    const rows = await this.tx.marketSnapshot.findMany({ where: { marketId }, orderBy: { sequence: "asc" } });
    return rows.map(toSnapshot);
  }

  /** Read-only view of a settlement, built from Resolution plus Forecast.payout. */
  async getSettlement(marketId: string): Promise<SettlementRecord | null> {
    const r = await this.tx.resolution.findUnique({ where: { marketId } });
    if (!r) return null;
    const forecasts = await this.tx.forecast.findMany({ where: { marketId }, orderBy: { sequence: "asc" } });
    const completed = r.settlementStatus === "COMPLETED";
    return {
      marketId,
      outcome: r.outcome,
      resolutionId: r.id,
      resolvedAt: r.resolvedAt,
      settledAt: completed ? r.settledAt : null,
      status: completed ? "completed" : "in_progress",
      settlementModelId: r.settlementModelId ?? "unknown",
      requestedBy: "resolution-workflow",
      payouts: forecasts.map((f) => ({
        forecastId: f.id,
        userId: f.userId,
        stake: f.credits,
        payout: f.payout ?? 0,
        net: (f.payout ?? 0) - f.credits,
        ledgerTransactionId: null,
      })),
    };
  }

  /** Settlement runs through lib/forecasting/server/settle.ts and Ky's state machine, not through this method. */
  async saveSettlement(): Promise<void> {
    throw new Error("Use forecastingSettle (lib/forecasting/server/settle.ts) to settle markets in the database");
  }

  async listSettlements() {
    const rows = await this.tx.resolution.findMany({ where: { settlementStatus: "COMPLETED" }, select: { marketId: true } });
    const out: SettlementRecord[] = [];
    for (const { marketId } of rows) {
      const s = await this.getSettlement(marketId);
      if (s) out.push(s);
    }
    return out;
  }
}

/**
 * Row lock on the market (SELECT ... FOR UPDATE), plus a transaction-scoped
 * advisory lock for any other key (e.g. a user's idempotency key). Keys are
 * taken in sorted order so concurrent requests can't deadlock.
 */
export class PrismaLockManager implements LockManager {
  constructor(private readonly tx: TxClient) {}

  async withLocks<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
    for (const key of [...new Set(keys)].sort()) {
      if (key.startsWith("market:")) {
        await this.tx.$executeRaw`SELECT "id" FROM "Market" WHERE "id" = ${key.slice("market:".length)} FOR UPDATE`;
      } else {
        await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      }
    }
    return fn();
  }
}
