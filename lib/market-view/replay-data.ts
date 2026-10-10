import "server-only";
import { db } from "@/lib/db";
import { PUBLIC_MARKET_WHERE } from "@/lib/permissions";
import { getMarket } from "./queries";
import {
  canReplay,
  derivedEvents,
  normalizePoints,
  type ActivityBucket,
  type ReplayData,
  type ReplayEvent,
  type ReplayPoint,
} from "./replay";
import { demoReplay, replayDemoEnabled } from "./replay-demo";

const MAX_SNAPSHOTS = 5000;
const MAX_FORECASTS = 20000;
const BUCKETS = 60;

/** Forecasts grouped into about 60 buckets across the replay. Counts only; no user is ever identified. */
export function bucketForecasts(
  rows: { createdAt: Date; side: "YES" | "NO"; credits: number; verifiedAtEntry: boolean }[],
  start: number,
  end: number,
): ActivityBucket[] {
  const size = Math.max(3_600_000, Math.ceil((end - start) / BUCKETS));
  const buckets = new Map<number, ActivityBucket>();
  for (const row of rows) {
    const at = row.createdAt.getTime();
    if (at < start || at > end) continue;
    const key = start + Math.floor((at - start) / size) * size;
    const bucket = buckets.get(key) ?? { start: key, end: key + size, yes: 0, no: 0, yesCredits: 0, noCredits: 0, verified: 0 };
    if (row.side === "YES") {
      bucket.yes++;
      bucket.yesCredits += row.credits;
    } else {
      bucket.no++;
      bucket.noCredits += row.credits;
    }
    if (row.verifiedAtEntry) bucket.verified++;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.start - b.start);
}

/**
 * Everything Market Replay needs for one public market, built from the same
 * MarketSnapshot records as the market chart. Returns null when the market is
 * not public.
 */
export async function getReplayData(slug: string, now: number): Promise<ReplayData | null> {
  const market = await getMarket(slug);
  if (!market) return null;

  const [snapshots, forecasts] = await Promise.all([
    db.marketSnapshot.findMany({
      where: { marketId: market.id, market: PUBLIC_MARKET_WHERE },
      orderBy: { sequence: "asc" },
      take: MAX_SNAPSHOTS,
      select: {
        recordedAt: true,
        modelValue: true,
        generalEstimate: true,
        specializedEstimate: true,
        forecastCount: true,
        yesCredits: true,
        noCredits: true,
      },
    }),
    db.forecast.findMany({
      where: { marketId: market.id, market: PUBLIC_MARKET_WHERE },
      orderBy: { createdAt: "asc" },
      take: MAX_FORECASTS,
      select: { createdAt: true, side: true, credits: true, verifiedAtEntry: true },
    }),
  ]);

  const points: ReplayPoint[] = normalizePoints(
    snapshots.map((row) => ({
      at: row.recordedAt.getTime(),
      model: row.modelValue,
      general: row.generalEstimate,
      verified: row.specializedEstimate,
      forecasts: row.forecastCount,
      credits: row.yesCredits + row.noCredits,
    })),
  );

  const opensAt = Date.parse(market.opensAt);
  const closesAt = Date.parse(market.closesAt);
  const resolvedAt = market.resolution ? Date.parse(market.resolution.resolvedAt) : null;
  const marketMeta = {
    slug: market.slug,
    question: market.question,
    startupName: market.startup.name,
    status: market.status,
    opensAt,
    closesAt,
  };
  const resolution = market.resolution
    ? { outcome: market.resolution.outcome, resolvedAt: resolvedAt!, evidenceUrl: market.resolution.evidenceUrls[0] ?? null }
    : null;

  if (!canReplay(points) && replayDemoEnabled()) {
    return demoReplay({ ...marketMeta, resolution }, now);
  }

  const start = Math.min(opensAt, points[0]?.at ?? opensAt);
  const lastPoint = points[points.length - 1]?.at ?? start;
  const end = Math.max(lastPoint, start + 1, resolvedAt ?? Math.min(now, closesAt > now ? now : Math.max(closesAt, lastPoint)));

  const events: ReplayEvent[] = [
    { id: "opened", at: opensAt, kind: "opened" as const, origin: "real" as const, title: "Market opened" },
    ...(market.openingBaseline !== null && market.baselineSetAt
      ? [
          {
            id: "baseline",
            at: Date.parse(market.baselineSetAt),
            kind: "baseline" as const,
            origin: "real" as const,
            title: `Opening baseline ${Math.round(market.openingBaseline * 100)}%`,
            detail: market.baselineMethodology ?? undefined,
          },
        ]
      : []),
    ...market.coverage.map((item) => ({
      id: `news-${item.id}`,
      at: Date.parse(item.publishedAt),
      kind: "news" as const,
      origin: "real" as const,
      title: item.title,
      detail: `${item.publisher}${item.verification === "VERIFIED" ? ", verified" : ", reported"}`,
      url: item.url,
    })),
    ...derivedEvents(points),
    ...(resolution
      ? [
          {
            id: "resolved",
            at: resolution.resolvedAt,
            kind: "resolved" as const,
            origin: "real" as const,
            title: resolution.outcome === "VOID" ? "Resolved as void" : `Resolved ${resolution.outcome}`,
            detail: market.resolution?.evidenceSummary,
            url: resolution.evidenceUrl ?? undefined,
          },
        ]
      : []),
  ]
    .filter((event) => event.at >= start && event.at <= end)
    .sort((a, b) => a.at - b.at);

  return {
    source: "real",
    market: marketMeta,
    start,
    end,
    points,
    events,
    activity: forecasts.length ? bucketForecasts(forecasts, start, end) : null,
    resolution,
  };
}
