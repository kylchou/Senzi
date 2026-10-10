/**
 * Integration ports. VC services depend only on these interfaces; the real
 * implementations live in lib/vc/server/*. Tests use the in-memory implementations in lib/vc/testing.
 */
import type {
  AlertType,
  EstimatePoint,
  MarketEstimate,
  MarketSummary,
  OrgMembership,
  SavedReport,
  SessionUser,
  StartupSummary,
  Study,
  StudyEvent,
  StudyNote,
  StudySource,
  StudyStatus,
  StudyVisibility,
  UserSummary,
  VcAlert,
  Watchlist,
  WatchlistItem,
  WatchlistItemType,
} from "./types";
import type { CreatedAlert, OrgMember, PersonalNotification } from "./alert-delivery";
import type {
  CompareIndicators,
  FirmObservation,
  MetricLink,
  ModelConfidence,
  ModelEstimate,
  OpeningLineMetric,
  StartupFactView,
  StartupNewsView,
  StudyModelEstimate,
} from "./types";

//identity, organizations, startups, market creation

export interface CreateMarketForStudyInput {
  /** Idempotency key: calling twice with the same studyId must return the same market. */
  studyId: string;
  organizationId: string;
  startupId: string;
  question: string;
  yesCriteria: string;
  noCriteria: string;
  closesAt: Date;
  openingBaseline: { value: number; methodology: string };
  /** The model estimate behind the opening baseline; starts the market's model line. */
  model: {
    low: number;
    high: number;
    confidence: ModelConfidence;
    asOf: Date;
    modelName: string;
    modelVersion: string;
    inputsHash: string;
    inputsNote: string;
    /** Public-safe: firm-entered values removed. */
    inputsUsed: Record<string, unknown>[];
    notes: string[];
  };
  /** Non-PUBLIC markets must be excluded from public market APIs. */
  visibility: StudyVisibility;
  sources: { url: string; title: string }[];
  createdById: string;
}

export interface PlatformGateway {
  getSessionUser(): Promise<SessionUser | null>;
  getMemberships(userId: string): Promise<OrgMembership[]>;
  getUsers(ids: string[]): Promise<UserSummary[]>;
  findUsersByEmail(emails: string[]): Promise<UserSummary[]>;
  /** Published startups only; unpublished ones are treated as nonexistent. */
  getStartups(ids: string[]): Promise<StartupSummary[]>;
  searchStartups(query: string, limit: number): Promise<StartupSummary[]>;
  /**
   * Public markets that were not opened from a study. Study markets are shown
   * through their study, which carries the right permissions and context.
   */
  listPublicMarketsForStartups(startupIds: string[]): Promise<MarketSummary[]>;
  createMarketForStudy(input: CreateMarketForStudyInput): Promise<{ marketId: string }>;
  /**
   * Facts and news about published startups. News tied to a non-public market
   * is excluded, so private markets never leak through news.
   */
  getStartupEvidence(startupIds: string[]): Promise<{ facts: StartupFactView[]; news: StartupNewsView[] }>;
  /** Current members of an organization, for alert delivery. */
  listOrgMembers(organizationId: string): Promise<OrgMember[]>;
  /** Writes personal inbox notifications (the shared Notification table). Returns rows written. */
  notifyUsers(notifications: PersonalNotification[]): Promise<number>;
  /** Marks a user's inbox notifications for these VC alerts as read. */
  markAlertNotificationsRead(userId: string, alertIds: string[], at: Date): Promise<void>;
  /** Stops forecasting on the study's market. Idempotent; a no-op if the study has no market. */
  closeMarketForStudy(input: { studyId: string; closedById: string | null; reason: string | null }): Promise<void>;
}

// ---------------------------------------------------------------------------
// forecasting estimates and history
// ---------------------------------------------------------------------------

export interface ForecastingGateway {
  /** Missing markets are omitted from the map. */
  getEstimates(marketIds: string[]): Promise<Map<string, MarketEstimate>>;
  getHistory(marketId: string, options?: { from?: Date; to?: Date }): Promise<EstimatePoint[]>;
}

// ---------------------------------------------------------------------------
// Persistence for VC-owned models
// ---------------------------------------------------------------------------

export interface NewStudy {
  organizationId: string;
  createdById: string;
  startupId: string;
  question: string;
  yesCriteria: string;
  noCriteria: string;
  context: string | null;
  baselineValue: number | null;
  baselineMethodology: string | null;
  deadline: Date;
  visibility: StudyVisibility;
  sources: Omit<StudySource, "id">[];
}

export type StudyPatch = Partial<
  Pick<
    Study,
    | "startupId"
    | "question"
    | "yesCriteria"
    | "noCriteria"
    | "context"
    | "baselineValue"
    | "baselineMethodology"
    | "deadline"
    | "visibility"
    | "status"
    | "marketId"
    | "rejectionReason"
    | "cancellationReason"
    | "submittedAt"
    | "approvedAt"
    | "openedAt"
    | "closedAt"
    | "resolvedAt"
    | "resolvedOutcome"
  >
> & { sources?: Omit<StudySource, "id">[] };

export type NewStudyEvent = Omit<StudyEvent, "id" | "createdAt" | "studyId">;

export interface StudyFilter {
  organizationId?: string;
  visibility?: StudyVisibility;
  statuses?: readonly StudyStatus[];
  participantUserId?: string;
  ids?: string[];
  startupIds?: string[];
  /** Only studies with a linked market. */
  hasMarket?: boolean;
  /** Only studies resolved at or after this time. */
  resolvedSince?: Date;
  limit?: number;
}

export interface NewAlert {
  organizationId: string;
  type: AlertType;
  studyId?: string | null;
  startupId?: string | null;
  marketId?: string | null;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  dedupeKey: string;
}

export interface VcRepository {
  findStudy(id: string): Promise<Study | null>;
  findStudyByMarketId(marketId: string): Promise<Study | null>;
  listStudies(filter: StudyFilter): Promise<Study[]>;
  createStudy(data: NewStudy): Promise<Study>;
  /**
   * Compare-and-set update: applies only if the stored version equals
   * `expectedVersion`, increments the version, and records `event` in the same
   * transaction. Returns null when the version no longer matches.
   */
  updateStudy(
    id: string,
    expectedVersion: number,
    patch: StudyPatch,
    event?: NewStudyEvent,
  ): Promise<Study | null>;
  replaceParticipants(studyId: string, userIds: string[], addedById: string): Promise<void>;
  listEvents(studyId: string): Promise<StudyEvent[]>;

  listNotes(studyId: string): Promise<StudyNote[]>;
  findNote(id: string): Promise<StudyNote | null>;
  createNote(data: Omit<StudyNote, "id" | "createdAt" | "updatedAt">): Promise<StudyNote>;
  deleteNote(id: string): Promise<void>;

  listWatchlists(organizationId: string): Promise<Watchlist[]>;
  listAllWatchlists(): Promise<Watchlist[]>;
  findWatchlist(id: string): Promise<Watchlist | null>;
  /** Returns null if a watchlist with that name already exists in the org. */
  createWatchlist(data: { organizationId: string; name: string; createdById: string }): Promise<Watchlist | null>;
  deleteWatchlist(id: string): Promise<void>;
  /** Idempotent: returns the existing item if it is already on the list. */
  addWatchlistItem(data: {
    watchlistId: string;
    type: WatchlistItemType;
    startupId: string | null;
    studyId: string | null;
    addedById: string;
  }): Promise<WatchlistItem>;
  removeWatchlistItem(watchlistId: string, itemId: string): Promise<boolean>;

  /** Inserts alerts, skipping any whose (organizationId, dedupeKey) already exists. Returns the inserted alerts. */
  createAlerts(alerts: NewAlert[]): Promise<CreatedAlert[]>;
  listAlerts(
    organizationId: string,
    userId: string,
    options: { unreadOnly?: boolean; type?: AlertType; limit: number },
  ): Promise<VcAlert[]>;
  /** Unread alert counts grouped by study (studyId null for alerts not tied to a study). */
  countUnreadAlertsByStudy(organizationId: string, userId: string): Promise<{ studyId: string | null; count: number }[]>;
  markAlertsRead(organizationId: string, userId: string, alertIds: string[], at: Date): Promise<void>;

  /** The study's stored opening line, or null if it was never estimated. */
  findModelEstimate(studyId: string): Promise<StudyModelEstimate | null>;
  findModelEstimates(studyIds: string[]): Promise<StudyModelEstimate[]>;
  /** Replaces the study's stored opening line. */
  saveModelEstimate(estimate: StudyModelEstimate): Promise<void>;
  /** Figures this firm entered for the startup on its company page (sponsor-provided ModelDataPoint rows). */
  listFirmFigures(organizationId: string, startupId: string): Promise<FirmObservation[]>;

  createReport(data: Omit<SavedReport, "id" | "createdAt">): Promise<SavedReport>;
  listReports(organizationId: string, options: { studyId?: string; limit: number }): Promise<SavedReport[]>;
  findReport(id: string): Promise<SavedReport | null>;
}

/** Public startup indicators from the model (downloads, repos, hiring, filings). */
export interface IndicatorGateway {
  getIndicators(startup: { slug: string; name: string }, asOf: Date): Promise<CompareIndicators>;
}

/**
 * The baseline model (lib/model). It turns a measurable question into an
 * opening line, and publishes later estimates to a market's model line.
 */
export interface ModelGateway {
  /** Metrics the model can forecast for this startup. */
  metricsFor(startup: { id: string; name: string; slug: string }): OpeningLineMetric[];
  /**
   * Runs the model with public history plus the firm's figures for the linked
   * metric. Never throws for missing data: returns INSUFFICIENT_DATA with notes.
   */
  estimate(input: {
    startup: { id: string; name: string; slug: string };
    link: MetricLink;
    observations: FirmObservation[];
    asOf: Date;
  }): Promise<ModelEstimate>;
  /**
   * Publishes a newer OK estimate to an open market's model line. The opening
   * price stays fixed once forecasting has started. Returns false when the
   * market already has this estimate.
   */
  publishUpdate(marketId: string, estimate: ModelEstimate): Promise<boolean>;
}

export interface VcDeps {
  repo: VcRepository;
  platform: PlatformGateway;
  forecasting: ForecastingGateway;
  indicators: IndicatorGateway;
  model: ModelGateway;
  now: () => Date;
}

