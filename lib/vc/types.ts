/**
 * VC Intelligence domain types.
 *
 * These types describe the VC study workflow and the read models it uses for
 * identity, organizations, startups, markets, and forecast estimates and
 * history. Persistence models live in prisma/schema.prisma.
 */

export const STUDY_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "APPROVED",
  "OPEN",
  "CLOSED",
  "RESOLVED",
  "REJECTED",
  "CANCELLED",
] as const;
export type StudyStatus = (typeof STUDY_STATUSES)[number];

/** Statuses in which a study is backed by a live or settled market. */
export const PUBLISHED_STATUSES: readonly StudyStatus[] = ["OPEN", "CLOSED", "RESOLVED"];
/** Statuses that will never change again. */
export const TERMINAL_STATUSES: readonly StudyStatus[] = ["RESOLVED", "CANCELLED"];

export const STUDY_VISIBILITIES = ["PUBLIC", "ORGANIZATION", "RESTRICTED"] as const;
export type StudyVisibility = (typeof STUDY_VISIBILITIES)[number];

export const ORG_ROLES = ["OWNER", "ADMIN", "ANALYST", "VIEWER"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export type ResolvedOutcome = "YES" | "NO" | "VOID";
export type MarketStatus = "DRAFT" | "OPEN" | "CLOSED" | "RESOLVED" | "CANCELLED";


// Identity

export interface SessionUser {
  id: string;
  name: string | null;
  email: string | null;
  /** Platform staff who review and approve submitted studies. */
  isPlatformAdmin: boolean;
}

export interface OrgMembership {
  organizationId: string;
  organizationName: string;
  role: OrgRole;
}

export interface VcContext {
  user: SessionUser;
  memberships: OrgMembership[];
  /** The organization the user is currently working in, if any. */
  activeOrg: OrgMembership | null;
}

export interface UserSummary {
  id: string;
  name: string | null;
  email: string | null;
}

export interface StartupSummary {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
}

export interface MarketSummary {
  id: string;
  /** Public market page slug (/markets/[slug]), when known. */
  slug?: string;
  startupId: string;
  question: string;
  status: MarketStatus;
  closesAt: Date | null;
}


// Forecast read models


export interface MarketEstimate {
  marketId: string;
  status: MarketStatus;
  /** Opening baseline set before any community forecasts. Not a forecast. */
  openingBaseline: { value: number; methodology: string | null } | null;
  /**
   * Community credit allocation. `yesShare` = YES credits / (YES + NO credits),
   * null when no credits are allocated. This is NOT a calibrated probability.
   */
  allocation: {
    yesCredits: number;
    noCredits: number;
    totalCredits: number;
    yesShare: number | null;
  };
  /** Only present when the forecasting engine has recorded a calibrated value. */
  calibratedProbability: CalibratedProbability | null;
  participantCount: number;
  forecastCount: number;
  lastForecastAt: Date | null;
  /** When this estimate was computed. */
  asOf: Date;
  resolution: {
    outcome: ResolvedOutcome;
    resolvedAt: Date;
    evidenceUrls: string[];
    evidenceSummary: string | null;
  } | null;
}

/** Calibration metadata is optional until the forecasting engine records it. */
export interface CalibratedProbability {
  value: number;
  method: string | null;
  sampleSize: number | null;
}

export interface EstimatePoint {
  at: Date;
  yesShare: number | null;
  totalCredits: number;
  participantCount: number;
}

// Studies

export interface StudySource {
  id: string;
  url: string;
  title: string;
  publisher: string | null;
  publishedAt: Date | null;
}

export interface Study {
  id: string;
  organizationId: string;
  createdById: string;
  startupId: string;
  marketId: string | null;
  question: string;
  yesCriteria: string;
  noCriteria: string;
  context: string | null;
  /** Opening baseline proposed by the firm, 0..1, with its methodology. */
  baselineValue: number | null;
  baselineMethodology: string | null;
  /** Forecasting closes at this time. */
  deadline: Date;
  visibility: StudyVisibility;
  status: StudyStatus;
  rejectionReason: string | null;
  cancellationReason: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  openedAt: Date | null;
  closedAt: Date | null;
  resolvedAt: Date | null;
  resolvedOutcome: ResolvedOutcome | null;
  /** Incremented on every write; used for optimistic concurrency. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
  sources: StudySource[];
  participantIds: string[];
}

export interface StudyEvent {
  id: string;
  studyId: string;
  /** null for system actions (deadline close, market resolution sync). */
  actorId: string | null;
  action: string;
  fromStatus: StudyStatus | null;
  toStatus: StudyStatus;
  reason: string | null;
  createdAt: Date;
}

export interface StudyNote {
  id: string;
  studyId: string;
  organizationId: string;
  authorId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

// Watchlists, alerts, reports

export type WatchlistItemType = "STARTUP" | "STUDY";

export interface WatchlistItem {
  id: string;
  watchlistId: string;
  type: WatchlistItemType;
  startupId: string | null;
  studyId: string | null;
  addedById: string;
  createdAt: Date;
}

export interface Watchlist {
  id: string;
  organizationId: string;
  name: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  items: WatchlistItem[];
}

export const ALERT_TYPES = [
  "FORECAST_MOVEMENT",
  "DEADLINE_APPROACHING",
  "STUDY_RESOLVED",
  "STUDY_STATUS_CHANGED",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface VcAlert {
  id: string;
  organizationId: string;
  type: AlertType;
  studyId: string | null;
  startupId: string | null;
  marketId: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  createdAt: Date;
  /** Read state for the requesting user. */
  readAt: Date | null;
}

export interface SavedReport {
  id: string;
  organizationId: string;
  studyId: string;
  createdById: string;
  title: string;
  content: StudyReport;
  createdAt: Date;
}

// Report document

export interface StudyReport {
  reportVersion: 1;
  generatedAt: string;
  organization: { id: string; name: string };
  study: {
    id: string;
    question: string;
    yesCriteria: string;
    noCriteria: string;
    context: string | null;
    status: StudyStatus;
    visibility: StudyVisibility;
    deadline: string;
    startup: { id: string; name: string } | null;
  };
  baseline: {
    value: number | null;
    methodology: string | null;
    source: "market" | "study" | null;
  };
  communityEstimate: {
    label: string;
    yesAllocationShare: number | null;
    yesCredits: number;
    noCredits: number;
    totalCredits: number;
    asOf: string;
    lastForecastAt: string | null;
  } | null;
  calibratedProbability: CalibratedProbability | null;
  participation: { participantCount: number; forecastCount: number } | null;
  trend: {
    points: { at: string; yesShare: number | null }[];
    changeSinceOpen: number | null;
    change7d: number | null;
    range: { min: number; max: number } | null;
  };
  sources: { title: string; url: string; publisher: string | null; publishedAt: string | null }[];
  resolution: {
    outcome: ResolvedOutcome;
    resolvedAt: string;
    evidenceUrls: string[];
    evidenceSummary: string | null;
  } | null;
  timeline: { at: string; action: string; toStatus: StudyStatus; reason: string | null }[];
  uncertainty: string[];
  limitations: string[];
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Startup comparison
// ---------------------------------------------------------------------------

/** One forecasting question about a startup, as shown in a comparison. */
export interface CompareQuestion {
  marketId: string;
  question: string;
  /** "study" when the market was opened from a study the viewer can see. */
  kind: "study" | "market";
  studyId: string | null;
  /** In-app link: the study page for study questions, the public market page otherwise. */
  href: string | null;
  status: MarketStatus;
  closesAt: Date | null;
  openingBaseline: number | null;
  /** Community YES credit-allocation share. Not a calibrated probability. */
  allocationShare: number | null;
  calibratedProbability: number | null;
  forecasters: number;
  forecastCount: number;
  /** Change in allocation share over 7 days; open questions only. */
  change7d: number | null;
  outcome: ResolvedOutcome | null;
}

export interface TrackRecord {
  /** Resolved questions with a YES or NO outcome. VOID ones are counted separately. */
  decided: number;
  yes: number;
  voided: number;
  yesRate: number | null;
  /** 95% Wilson interval for the YES rate. */
  yesRateInterval: [number, number] | null;
  /** Brier score of the opening baseline against outcomes (lower is better). */
  baselineBrier: number | null;
  /** Brier score of the final allocation share against outcomes. Measures accuracy; the share is still not a probability. */
  allocationShareBrier: number | null;
  /** Plain-language caveats, e.g. small samples. */
  limitations: string[];
}

export interface CompareIndicator {
  metricId: string;
  label: string;
  unit: string;
  value: number | null;
  asOf: string | null;
  change4w: number | null;
  sourceUrl: string | null;
  provenanceLabel: string;
  missingReason: string | null;
}

export interface CompareIndicators {
  status: "ok" | "not_tracked" | "unavailable";
  rows: CompareIndicator[];
}

export interface CompareColumn {
  startup: StartupSummary;
  open: CompareQuestion[];
  closed: CompareQuestion[];
  resolved: CompareQuestion[];
  trackRecord: TrackRecord;
  indicators: CompareIndicators;
}

export interface StartupComparison {
  generatedAt: Date;
  columns: CompareColumn[];
  limitations: string[];
}
