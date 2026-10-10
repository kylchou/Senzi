import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { MarketQuery } from "@/lib/discovery/params";
import { PUBLIC_MARKET_WHERE, PUBLIC_STARTUP_WHERE } from "@/lib/permissions";
import { rankMoves, type MarketMove } from "./insights";
import { cleanShare, marketDetailSelect, marketSummarySelect, toMarketDetail, toMarketSummary } from "./mappers";
import { openingPrice, pricesAfterTrades } from "./probability";
import type { CursorPage, HistoryPoint, MarketDetail, MarketSummary } from "./types";

const HISTORY_LIMIT = 1000;

/** Listing and search filter. PUBLIC_MARKET_WHERE excludes drafts, VC markets, and unpublished startups. */
export function publicMarketFilter(params: Pick<MarketQuery, "q" | "status" | "industry">): Prisma.MarketWhereInput {
  const and: Prisma.MarketWhereInput[] = [PUBLIC_MARKET_WHERE];
  if (params.q) {
    and.push({
      OR: [
        { question: { contains: params.q, mode: "insensitive" } },
        { startup: { name: { contains: params.q, mode: "insensitive" } } },
      ],
    });
  }
  if (params.status) and.push({ status: params.status });
  if (params.industry) and.push({ startup: { industry: params.industry } });
  return { AND: and };
}

/** Every ordering ends on id so cursor pagination is stable. */
export function marketOrder(sort: MarketQuery["sort"]): Prisma.MarketOrderByWithRelationInput[] {
  switch (sort) {
    case "active":
      return [{ forecastCount: "desc" }, { id: "asc" }];
    case "newest":
      return [{ createdAt: "desc" }, { id: "asc" }];
    default:
      // Enum order puts OPEN first, then CLOSED, RESOLVED, CANCELLED.
      return [{ status: "asc" }, { closesAt: "asc" }, { id: "asc" }];
  }
}

interface Replayed {
  /** Price right after each forecast, by forecast id. */
  byForecast: Map<string, number>;
  /** Current price. */
  last: number;
}

/**
 * Market probability from the trades themselves, for markets whose snapshots
 * predate the engine storing it (see ./probability.ts).
 */
async function replayPrices(marketIds: string[]): Promise<Map<string, Replayed>> {
  if (marketIds.length === 0) return new Map();
  const [markets, forecasts] = await Promise.all([
    db.market.findMany({ where: { id: { in: marketIds } }, select: { id: true, openingBaseline: true } }),
    db.forecast.findMany({
      where: { marketId: { in: marketIds } },
      orderBy: [{ marketId: "asc" }, { sequence: "asc" }],
      select: { id: true, marketId: true, side: true, credits: true },
    }),
  ]);
  const result = new Map<string, Replayed>();
  for (const market of markets) {
    const trades = forecasts.filter((f) => f.marketId === market.id);
    const prices = pricesAfterTrades(market.openingBaseline, trades);
    result.set(market.id, {
      byForecast: new Map(trades.map((trade, index) => [trade.id, prices[index]!])),
      last: prices.at(-1) ?? openingPrice(market.openingBaseline),
    });
  }
  return result;
}

/** Fills in market probability where the latest snapshot didn't store it. */
async function withProbabilities<T extends MarketSummary>(items: T[]): Promise<T[]> {
  const missing = items.filter((item) => item.probability === null).map((item) => item.id);
  if (missing.length === 0) return items;
  const replayed = await replayPrices(missing);
  return items.map((item) => (item.probability === null ? { ...item, probability: replayed.get(item.id)?.last ?? null } : item));
}

export async function listMarkets(params: MarketQuery): Promise<CursorPage<MarketSummary>> {
  const where = publicMarketFilter(params);
  const [rows, total] = await Promise.all([
    db.market.findMany({
      where,
      select: marketSummarySelect,
      orderBy: marketOrder(params.sort),
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    db.market.count({ where }),
  ]);
  const items = await withProbabilities(rows.slice(0, params.limit).map(toMarketSummary));
  return {
    items,
    nextCursor: rows.length > params.limit ? items[items.length - 1].id : null,
    limit: params.limit,
    total,
  };
}

export async function listFeaturedMarkets(limit = 6): Promise<MarketSummary[]> {
  const { items } = await listMarkets({ status: "OPEN", sort: "active", limit, q: undefined, industry: undefined, cursor: undefined });
  return items;
}

/** A single public market by slug. VC markets and drafts return null. */
export const getMarket = cache(async (slug: string): Promise<MarketDetail | null> => {
  const row = await db.market.findFirst({ where: { AND: [{ slug }, PUBLIC_MARKET_WHERE] }, select: marketDetailSelect });
  return row ? (await withProbabilities([toMarketDetail(row)]))[0]! : null;
});

/** Market probability over time from MarketSnapshot rows, oldest first. */
export async function getMarketHistory(marketId: string): Promise<HistoryPoint[]> {
  const rows = (
    await db.marketSnapshot.findMany({
      where: { marketId, market: PUBLIC_MARKET_WHERE },
      orderBy: { sequence: "desc" },
      take: HISTORY_LIMIT,
      select: {
        recordedAt: true,
        generalEstimate: true,
        calibratedProbability: true,
        forecasterCount: true,
        forecastId: true,
        trigger: true,
        openingBaseline: true,
      },
    })
  ).reverse();
  const replayed = rows.some((row) => row.generalEstimate === null) ? (await replayPrices([marketId])).get(marketId) : undefined;

  let previous: number | null = null;
  return rows.map((row) => {
    const share =
      cleanShare(row.generalEstimate) ??
      (row.forecastId ? (replayed?.byForecast.get(row.forecastId) ?? null) : null) ??
      (row.trigger === "OPENING" ? openingPrice(row.openingBaseline) : previous);
    previous = share ?? previous;
    return {
      at: row.recordedAt.toISOString(),
      share,
      calibrated: cleanShare(row.calibratedProbability),
      forecasterCount: row.forecasterCount,
    };
  });
}

export async function listMarketsForStartup(startupId: string): Promise<MarketSummary[]> {
  const rows = await db.market.findMany({
    where: { AND: [PUBLIC_MARKET_WHERE, { startupId }] },
    select: marketSummarySelect,
    orderBy: marketOrder("closing"),
    take: 50,
  });
  return withProbabilities(rows.map(toMarketSummary));
}

export async function getPublicCounts(): Promise<{ openMarkets: number; startups: number }> {
  const [openMarkets, startups] = await Promise.all([
    db.market.count({ where: { AND: [PUBLIC_MARKET_WHERE, { status: "OPEN" }] } }),
    db.startup.count({ where: PUBLIC_STARTUP_WHERE }),
  ]);
  return { openMarkets, startups };
}

/**
 * Open markets whose market probability moved most over the last week, or the
 * last month when nothing moved this week. Compares the current probability
 * with the latest snapshot recorded before the window started.
 */
export async function listBiggestMoves(now: number, limit = 4): Promise<{ days: number; moves: MarketMove[] }> {
  const rows = await db.market.findMany({
    where: { AND: [PUBLIC_MARKET_WHERE, { status: "OPEN" }] },
    select: marketSummarySelect,
    take: 300,
  });
  const markets = await withProbabilities(rows.map(toMarketSummary));
  const ids = markets.map((market) => market.id);
  if (ids.length === 0) return { days: 7, moves: [] };
  let replayed: Map<string, Replayed> | null = null;

  for (const days of [7, 30]) {
    const past = await db.marketSnapshot.findMany({
      where: { marketId: { in: ids }, recordedAt: { lte: new Date(now - days * 86_400_000) } },
      orderBy: [{ marketId: "asc" }, { sequence: "desc" }],
      distinct: ["marketId"],
      select: { marketId: true, generalEstimate: true, forecastId: true, trigger: true, openingBaseline: true },
    });
    if (!replayed && past.some((row) => row.generalEstimate === null)) {
      replayed = await replayPrices([...new Set(past.filter((row) => row.generalEstimate === null).map((row) => row.marketId))]);
    }
    const priceOf = (row: (typeof past)[number]) =>
      cleanShare(row.generalEstimate) ??
      (row.forecastId ? (replayed?.get(row.marketId)?.byForecast.get(row.forecastId) ?? null) : openingPrice(row.openingBaseline));
    const from = new Map(past.map((row) => [row.marketId, priceOf(row)]));
    const moves = rankMoves(
      markets.map((market) => ({ market, from: from.get(market.id) ?? null })),
      limit,
    );
    if (moves.length > 0) return { days, moves };
  }
  return { days: 7, moves: [] };
}

/** The prize pool a firm attached to this market's question, if any (0 when none). */
export async function getMarketPrizePool(marketId: string): Promise<{ credits: number; paid: boolean }> {
  const study = await db.researchStudy.findUnique({
    where: { marketId },
    select: { prizePoolCredits: true, prizeDistributedAt: true },
  });
  return { credits: study?.prizePoolCredits ?? 0, paid: !!study?.prizeDistributedAt };
}
