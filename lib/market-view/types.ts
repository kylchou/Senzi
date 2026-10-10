import type { NewsVerification, ResolutionOutcome, StartupStage } from "@/lib/types";

/**
 * Public view models returned by app/api/markets/** and app/api/startups/**
 * and rendered by the community UI. Dates are ISO 8601 strings.
 *
 * Three measurements are kept apart on purpose (docs/API.md):
 * - openingBaseline: admin-set starting estimate. Not a community signal.
 * - allocation.share: YES credits / (YES + NO credits). Where forecasters put
 *   virtual credits. Never presented as a probability.
 * - calibratedProbability: model estimate from the forecasting engine, null
 *   until computed.
 * The resolved outcome is separate again and only set after resolution.
 */

export const PUBLIC_MARKET_STATUSES = ["OPEN", "CLOSED", "RESOLVED", "CANCELLED"] as const;
export type PublicMarketStatus = (typeof PUBLIC_MARKET_STATUSES)[number];

export interface StartupRef {
  slug: string;
  name: string;
  sector: string;
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
  openingBaseline: number;
  allocation: AllocationView;
  /** Latest model estimate from the forecasting engine, or null. */
  calibratedProbability: number | null;
  /** Unique forecasters at the latest snapshot, or null without one. */
  forecasterCount: number | null;
  /** When the latest snapshot was captured, or null. */
  updatedAt: string | null;
  outcome: ResolutionOutcome | null;
  resolvedAt: string | null;
}

export interface ResolutionView {
  outcome: ResolutionOutcome;
  evidenceSummary: string;
  evidenceUrls: string[];
  resolvedAt: string;
}

export interface MarketDetail extends MarketSummary {
  description: string | null;
  resolutionCriteria: string;
  resolutionSource: string | null;
  category: string | null;
  opensAt: string;
  resolvesBy: string | null;
  resolution: ResolutionView | null;
  coverage: NewsItemView[];
  startup: StartupRef & { tagline: string; website: string | null };
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
  sector: string;
  stage: StartupStage;
  headquarters: string | null;
  foundedYear: number | null;
  logoUrl: string | null;
  openMarketCount: number;
}

export interface NewsItemView {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  summary: string | null;
  verification: NewsVerification;
  startup: { slug: string; name: string } | null;
}

export interface StartupProfile extends StartupSummary {
  description: string;
  website: string | null;
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
