import type { NewsVerification, ResolutionOutcome, SettlementStatus, StartupStage } from "@/lib/types";

/**
 * Public view models returned by app/api/markets/** and app/api/startups/**
 * and rendered by the community UI. Dates are ISO 8601 strings.
 *
 * Three measurements are kept apart on purpose (docs/API.md):
 * - openingBaseline: starting estimate with its methodology. Not a community signal.
 * - allocation.share: YES credits / (YES + NO credits). Where forecasters put
 *   virtual credits. Never presented as a probability.
 * - calibratedProbability: from the forecasting engine, only once a
 *   calibration report supports it.
 * The resolved outcome is separate again and only set after resolution.
 */

export const PUBLIC_MARKET_STATUSES = ["OPEN", "CLOSED", "RESOLVED", "CANCELLED"] as const;
export type PublicMarketStatus = (typeof PUBLIC_MARKET_STATUSES)[number];

export interface StartupRef {
  slug: string;
  name: string;
  industry: string;
  logoUrl: string | null;
}

export interface AllocationView {
  /** 0 to 1, or null when no credits have been allocated. */
  share: number | null;
  yesCredits: number;
  noCredits: number;
  forecastCount: number;
}

export interface MarketSummary {
  id: string;
  slug: string;
  question: string;
  status: PublicMarketStatus;
  closesAt: string;
  startup: StartupRef;
  /** Null when no baseline was set. */
  openingBaseline: number | null;
  allocation: AllocationView;
  /** Latest calibrated probability from the forecasting engine, or null. */
  calibratedProbability: number | null;
  /** Unique forecasters at the latest snapshot, or null without one. */
  forecasterCount: number | null;
  /** When the latest snapshot was recorded, or null. */
  updatedAt: string | null;
  outcome: ResolutionOutcome | null;
  resolvedAt: string | null;
}

export interface SourceView {
  title: string;
  url: string;
  publisher: string | null;
  publishedAt: string | null;
}

export interface ResolutionView {
  outcome: ResolutionOutcome;
  evidenceSummary: string;
  evidenceUrls: string[];
  resolvedAt: string;
  settlementStatus: SettlementStatus;
  settledAt: string | null;
}

export interface MarketDetail extends MarketSummary {
  description: string | null;
  yesCriteria: string;
  noCriteria: string;
  baselineMethodology: string | null;
  baselineSetAt: string | null;
  category: string | null;
  opensAt: string;
  resolvesBy: string | null;
  sources: SourceView[];
  resolution: ResolutionView | null;
  coverage: NewsItemView[];
  startup: StartupRef & { tagline: string; websiteUrl: string | null };
}

export interface HistoryPoint {
  at: string;
  /** YES allocation share, or null when no credits were allocated. */
  share: number | null;
  /** Calibrated probability at this snapshot, or null. */
  calibrated: number | null;
  forecasterCount: number;
}

export interface StartupSummary {
  slug: string;
  name: string;
  tagline: string;
  industry: string;
  stage: StartupStage;
  headquarters: string | null;
  foundedYear: number | null;
  logoUrl: string | null;
  openMarketCount: number;
}

export interface StartupFactView {
  label: string;
  value: string;
  sourceName: string;
  sourceUrl: string;
  asOf: string;
  verified: boolean;
}

export interface NewsItemView {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt: string;
  summary: string | null;
  verification: NewsVerification;
  startup: { slug: string; name: string } | null;
}

export interface StartupProfile extends StartupSummary {
  description: string;
  websiteUrl: string | null;
  facts: StartupFactView[];
  markets: MarketSummary[];
  news: NewsItemView[];
}

/** Cursor page, matching the `{ data, meta: { nextCursor, limit } }` envelope. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
  total: number;
}
