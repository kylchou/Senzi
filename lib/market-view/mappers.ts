import type { Prisma } from "@/generated/prisma/client";
import type {
  HistoryPoint,
  MarketDetail,
  MarketSummary,
  NewsItemView,
  PublicMarketStatus,
  StartupRef,
} from "./types";

export const startupRefSelect = {
  slug: true,
  name: true,
  sector: true,
  logoUrl: true,
} satisfies Prisma.StartupSelect;

const latestSnapshot = {
  orderBy: { capturedAt: "desc" },
  take: 1,
  select: { calibratedProbability: true, uniqueForecasters: true, capturedAt: true },
} satisfies Prisma.Market$snapshotsArgs;

export const marketSummarySelect = {
  id: true,
  slug: true,
  question: true,
  status: true,
  closesAt: true,
  openingBaseline: true,
  yesCredits: true,
  noCredits: true,
  forecastCount: true,
  startup: { select: startupRefSelect },
  snapshots: latestSnapshot,
  resolution: { select: { outcome: true, resolvedAt: true } },
} satisfies Prisma.MarketSelect;

export const newsItemSelect = {
  id: true,
  title: true,
  sourceUrl: true,
  sourceName: true,
  publishedAt: true,
  summary: true,
  verification: true,
  startup: { select: { slug: true, name: true, isPublished: true } },
} satisfies Prisma.NewsItemSelect;

export const marketDetailSelect = {
  ...marketSummarySelect,
  description: true,
  resolutionCriteria: true,
  resolutionSource: true,
  category: true,
  opensAt: true,
  resolvesBy: true,
  startup: { select: { ...startupRefSelect, tagline: true, website: true } },
  resolution: { select: { outcome: true, resolvedAt: true, evidenceSummary: true, evidenceUrls: true } },
  news: { orderBy: { publishedAt: "desc" }, take: 10, select: newsItemSelect },
} satisfies Prisma.MarketSelect;

type SummaryRow = Prisma.MarketGetPayload<{ select: typeof marketSummarySelect }>;
type DetailRow = Prisma.MarketGetPayload<{ select: typeof marketDetailSelect }>;
type NewsRow = Prisma.NewsItemGetPayload<{ select: typeof newsItemSelect }>;

/** Keep values in [0, 1]; anything else becomes null so the UI never shows a bad figure. */
export function cleanShare(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

/** Community allocation share: YES credits / (YES + NO credits). Null when nothing is allocated. */
export function allocationShare(yesCredits: number, noCredits: number): number | null {
  const total = yesCredits + noCredits;
  return total > 0 ? yesCredits / total : null;
}

function toStartupRef(row: SummaryRow["startup"]): StartupRef {
  return { slug: row.slug, name: row.name, sector: row.sector, logoUrl: row.logoUrl };
}

export function toMarketSummary(row: SummaryRow): MarketSummary {
  const snapshot = row.snapshots[0];
  return {
    id: row.id,
    slug: row.slug,
    question: row.question,
    // Public queries exclude DRAFT, so the remaining statuses are public ones.
    status: row.status as PublicMarketStatus,
    closesAt: row.closesAt.toISOString(),
    startup: toStartupRef(row.startup),
    openingBaseline: row.openingBaseline,
    allocation: {
      share: allocationShare(row.yesCredits, row.noCredits),
      yesCredits: row.yesCredits,
      noCredits: row.noCredits,
      forecastCount: row.forecastCount,
    },
    calibratedProbability: cleanShare(snapshot?.calibratedProbability),
    forecasterCount: snapshot?.uniqueForecasters ?? null,
    updatedAt: snapshot?.capturedAt.toISOString() ?? null,
    outcome: row.resolution?.outcome ?? null,
    resolvedAt: row.resolution?.resolvedAt.toISOString() ?? null,
  };
}

/** News rows linked to an unpublished startup lose the startup link rather than exposing it. */
export function toNewsItem(row: NewsRow): NewsItemView {
  return {
    id: row.id,
    title: row.title,
    url: row.sourceUrl,
    sourceName: row.sourceName,
    publishedAt: row.publishedAt.toISOString(),
    summary: row.summary,
    verification: row.verification,
    startup: row.startup?.isPublished ? { slug: row.startup.slug, name: row.startup.name } : null,
  };
}

export function toMarketDetail(row: DetailRow): MarketDetail {
  return {
    ...toMarketSummary(row),
    description: row.description,
    resolutionCriteria: row.resolutionCriteria,
    resolutionSource: row.resolutionSource,
    category: row.category,
    opensAt: row.opensAt.toISOString(),
    resolvesBy: row.resolvesBy?.toISOString() ?? null,
    resolution: row.resolution
      ? {
          outcome: row.resolution.outcome,
          evidenceSummary: row.resolution.evidenceSummary,
          evidenceUrls: row.resolution.evidenceUrls,
          resolvedAt: row.resolution.resolvedAt.toISOString(),
        }
      : null,
    coverage: row.news.map(toNewsItem),
    startup: { ...toStartupRef(row.startup), tagline: row.startup.tagline, website: row.startup.website },
  };
}

export function toHistoryPoint(row: {
  capturedAt: Date;
  communityAllocationShare: number | null;
  calibratedProbability: number | null;
  uniqueForecasters: number;
}): HistoryPoint {
  return {
    at: row.capturedAt.toISOString(),
    share: cleanShare(row.communityAllocationShare),
    calibrated: cleanShare(row.calibratedProbability),
    forecasterCount: row.uniqueForecasters,
  };
}
