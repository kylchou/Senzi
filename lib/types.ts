/**
 * Shared Senzi types and API contracts.
 *
 * Owned by Engineer 1. Safe to import from client and server code: this file
 * only re-exports enums (plain objects) and declares types.
 * See docs/API.md for the HTTP contracts that use these shapes.
 */
export {
  AccountType,
  CreditTransactionType,
  EstimateKind,
  ForecastSide,
  ForecastStatus,
  MarketStatus,
  MarketVisibility,
  NewsVerification,
  NotificationType,
  OrgRole,
  PlatformRole,
  ResolutionOutcome,
  SettlementStatus,
  SnapshotTrigger,
  StartupStage,
  StudyStatus,
  StudyVisibility,
  VcAlertType,
  WatchlistItemType,
} from "@/generated/prisma/enums";

import type {
  AccountType,
  CreditTransactionType,
  MarketStatus,
  MarketVisibility,
  OrgRole,
  PlatformRole,
  ResolutionOutcome,
  SettlementStatus,
  StartupStage,
} from "@/generated/prisma/enums";

export type {
  Achievement,
  CreditTransaction,
  Forecast,
  Market,
  MarketSnapshot,
  MarketSource,
  NewsItem,
  Notification,
  Organization,
  OrganizationMembership,
  ResearchStudy,
  Resolution,
  Startup,
  StartupFact,
  StudyEvent,
  StudyNote,
  StudyParticipant,
  StudySource,
  User,
  VcAlert,
  VcAlertReceipt,
  VcReport,
  Watchlist,
  WatchlistItem,
} from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Virtual credits granted once when a user first signs in. */
export const SIGNUP_GRANT_CREDITS = 1_000;

/** Largest absolute amount allowed in a single ledger transaction. */
export const MAX_CREDIT_TRANSACTION = 1_000_000;

/** authId prefix for people invited by email who have not signed in yet. */
export const PENDING_AUTH_PREFIX = "pending:";

/** Usernames that would collide with /api/users/* routes. */
export const RESERVED_USERNAMES = ["me", "webhooks", "admin", "settings"] as const;

/** Request metadata passed to services for audit logging. */
export interface RequestContext {
  ip?: string | null;
}

/** Higher number = more privileged. */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  ANALYST: 2,
  VIEWER: 1,
};

// ---------------------------------------------------------------------------
// API envelope (lib/api-response.ts produces these)
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INSUFFICIENT_CREDITS"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiSuccess<T> {
  data: T;
  meta?: PageMeta;
}

export interface ApiFailure {
  error: {
    code: ApiErrorCode;
    message: string;
    /** For VALIDATION_ERROR: one entry per invalid field. */
    details?: ValidationIssue[] | Record<string, unknown>;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Cursor pagination: pass `nextCursor` back as `?cursor=` for the next page. */
export interface PageMeta {
  nextCursor: string | null;
  limit: number;
}

// ---------------------------------------------------------------------------
// Identity DTOs
// ---------------------------------------------------------------------------

/** The signed-in user as resolved by lib/auth.ts. Server-side only data. */
export interface SessionUser {
  id: string;
  authId: string;
  email: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  platformRole: PlatformRole;
  /** Null until chosen (see /onboarding). */
  accountType: AccountType | null;
}

/** Safe to show anyone. Never includes email or credit balance. */
export interface PublicUserProfile {
  id: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
}

export interface MembershipSummary {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrgRole;
}

/** GET /api/users/me */
export interface CurrentUserResponse extends SessionUser {
  bio: string | null;
  creditBalance: number;
  memberships: MembershipSummary[];
  createdAt: string;
}

export interface OrganizationMemberDTO {
  userId: string;
  displayName: string;
  username: string | null;
  email: string;
  avatarUrl: string | null;
  role: OrgRole;
  /** True until the invited person signs in for the first time. */
  pending: boolean;
  joinedAt: string;
}

// ---------------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------------

export interface CreditTransactionDTO {
  id: string;
  amount: number;
  balanceAfter: number;
  type: CreditTransactionType;
  marketId: string | null;
  forecastId: string | null;
  resolutionId: string | null;
  memo: string | null;
  createdAt: string;
}

/** Input for lib/credits.ts applyCreditTransaction / recordCreditTransaction. */
export interface CreditMutationInput {
  userId: string;
  /** Signed whole credits: positive credits the user, negative debits. */
  amount: number;
  type: CreditTransactionType;
  /**
   * Globally unique and stable for the logical operation. Conventions:
   *   signup:<userId>
   *   forecast:<forecastId>
   *   forecast-reversal:<forecastId>
   *   settlement:<marketId>:<forecastId>
   *   achievement:<userId>:<achievementKey>
   *   admin:<client-generated uuid>
   */
  idempotencyKey: string;
  marketId?: string | null;
  forecastId?: string | null;
  resolutionId?: string | null;
  actorId?: string | null;
  memo?: string | null;
}

// ---------------------------------------------------------------------------
// Markets (admin view; public read models are owned by Engineer 4)
// ---------------------------------------------------------------------------

export interface AdminMarketSummary {
  id: string;
  slug: string;
  question: string;
  status: MarketStatus;
  visibility: MarketVisibility;
  startup: { id: string; name: string; slug: string };
  openingBaseline: number | null;
  opensAt: string;
  closesAt: string;
  forecastCount: number;
  resolution: {
    outcome: ResolutionOutcome;
    settlementStatus: SettlementStatus;
    resolvedAt: string;
  } | null;
}

export interface AdminStartupSummary {
  id: string;
  slug: string;
  name: string;
  industry: string;
  stage: StartupStage;
  isPublished: boolean;
  marketCount: number;
}

// ---------------------------------------------------------------------------
// Settlement contract (implemented by Engineer 2)
// ---------------------------------------------------------------------------

// The settlement hook is SettleFn in lib/settlement.ts: that module runs the
// PENDING -> IN_PROGRESS -> COMPLETED/FAILED state machine and calls the
// forecasting engine's function to compute and pay out credits.
export type { SettleFn, SettleInput, SettlementRun } from "@/lib/settlement";
