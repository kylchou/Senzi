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
  getStartups(ids: string[]): Promise<StartupSummary[]>;
  searchStartups(query: string, limit: number): Promise<StartupSummary[]>;
  /** Public markets only — never markets linked to private studies. */
  listPublicMarketsForStartups(startupIds: string[]): Promise<MarketSummary[]>;
  createMarketForStudy(input: CreateMarketForStudyInput): Promise<{ marketId: string }>;
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

  /** Inserts alerts, skipping any whose (organizationId, dedupeKey) already exists. Returns inserted count. */
  createAlerts(alerts: NewAlert[]): Promise<number>;
  listAlerts(
    organizationId: string,
    userId: string,
    options: { unreadOnly?: boolean; type?: AlertType; limit: number },
  ): Promise<VcAlert[]>;
  markAlertsRead(organizationId: string, userId: string, alertIds: string[], at: Date): Promise<void>;

  createReport(data: Omit<SavedReport, "id" | "createdAt">): Promise<SavedReport>;
  listReports(organizationId: string, options: { studyId?: string; limit: number }): Promise<SavedReport[]>;
  findReport(id: string): Promise<SavedReport | null>;
}

export interface VcDeps {
  repo: VcRepository;
  platform: PlatformGateway;
  forecasting: ForecastingGateway;
  now: () => Date;
}

