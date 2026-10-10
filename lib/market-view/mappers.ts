import type { Prisma } from "@/generated/prisma/client";
import { openingPrice } from "./probability";
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
  industry: true,
  logoUrl: true,
} satisfies Prisma.StartupSelect;

const latestSnapshot = {
  orderBy: { sequence: "desc" },
  take: 1,
  select: { calibratedProbability: true, generalEstimate: true, forecasterCount: true, recordedAt: true },
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
  verifiedUsersOnly: true,
  startup: { select: startupRefSelect },
  snapshots: latestSnapshot,
  resolution: { select: { outcome: true, resolvedAt: true } },
} satisfies Prisma.MarketSelect;

export const newsItemSelect = {
  id: true,
  title: true,
  url: true,
  publisher: true,
  publishedAt: true,
  summary: true,
  verification: true,
  startup: { select: { slug: true, name: true, isPublished: true } },
} satisfies Prisma.NewsItemSelect;

export const marketDetailSelect = {
  ...marketSummarySelect,
  description: true,
  yesCriteria: true,
  noCriteria: true,
  baselineMethodology: true,
  baselineSetAt: true,
  category: true,
  opensAt: true,
  resolvesBy: true,
  startup: { select: { ...startupRefSelect, tagline: true, websiteUrl: true } },
  sources: {
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { title: true, url: true, publisher: true, publishedAt: true },
  },
  resolution: {
    select: {
      outcome: true,
      resolvedAt: true,
      evidenceSummary: true,
      evidenceUrls: true,
      settlementStatus: true,
      settledAt: true,
    },
  },
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
  return { slug: row.slug, name: row.name, industry: row.industry, logoUrl: row.logoUrl };
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
    verifiedUsersOnly: row.verifiedUsersOnly,
    startup: toStartupRef(row.startup),
    openingBaseline: cleanShare(row.openingBaseline),
    // Stored by the engine on each trade. With no trades yet, the market sits at its opening price.
    // Older snapshots without it are filled in by lib/market-view/queries.ts.
    probability: cleanShare(snapshot?.generalEstimate) ?? (row.forecastCount === 0 ? openingPrice(row.openingBaseline) : null),
    allocation: {
      share: allocationShare(row.yesCredits, row.noCredits),
      yesCredits: row.yesCredits,
      noCredits: row.noCredits,
      forecastCount: row.forecastCount,
    },
    calibratedProbability: cleanShare(snapshot?.calibratedProbability),
    forecasterCount: snapshot?.forecasterCount ?? null,
    updatedAt: snapshot?.recordedAt.toISOString() ?? null,
    outcome: row.resolution?.outcome ?? null,
    resolvedAt: row.resolution?.resolvedAt.toISOString() ?? null,
  };
}

/** News rows linked to an unpublished startup lose the startup link rather than exposing it. */
export function toNewsItem(row: NewsRow): NewsItemView {
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    publisher: row.publisher,
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
    yesCriteria: row.yesCriteria,
    noCriteria: row.noCriteria,
    baselineMethodology: row.baselineMethodology,
    baselineSetAt: row.baselineSetAt?.toISOString() ?? null,
    category: row.category,
    opensAt: row.opensAt.toISOString(),
    resolvesBy: row.resolvesBy?.toISOString() ?? null,
    sources: row.sources.map((source) => ({
      title: source.title,
      url: source.url,
      publisher: source.publisher,
      publishedAt: source.publishedAt?.toISOString() ?? null,
    })),
    resolution: row.resolution
      ? {
          outcome: row.resolution.outcome,
          evidenceSummary: row.resolution.evidenceSummary,
          evidenceUrls: row.resolution.evidenceUrls,
          resolvedAt: row.resolution.resolvedAt.toISOString(),
          settlementStatus: row.resolution.settlementStatus,
          settledAt: row.resolution.settledAt?.toISOString() ?? null,
        }
      : null,
    coverage: row.news.map(toNewsItem),
    startup: { ...toStartupRef(row.startup), tagline: row.startup.tagline, websiteUrl: row.startup.websiteUrl },
  };
}

export function toHistoryPoint(row: {
  recordedAt: Date;
  allocationShare: number | null;
  calibratedProbability: number | null;
  forecasterCount: number;
}): HistoryPoint {
  return {
    at: row.recordedAt.toISOString(),
    share: cleanShare(row.allocationShare),
    calibrated: cleanShare(row.calibratedProbability),
    forecasterCount: row.forecasterCount,
  };
}
