-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "StartupStage" AS ENUM ('PRE_SEED', 'SEED', 'SERIES_A', 'SERIES_B', 'SERIES_C', 'GROWTH', 'PUBLIC', 'ACQUIRED', 'SHUT_DOWN');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MarketVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ForecastSide" AS ENUM ('YES', 'NO');

-- CreateEnum
CREATE TYPE "ForecastStatus" AS ENUM ('ACTIVE', 'SETTLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "ResolutionOutcome" AS ENUM ('YES', 'NO', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('SIGNUP_GRANT', 'ADMIN_GRANT', 'ADMIN_ADJUSTMENT', 'FORECAST_STAKE', 'SETTLEMENT_PAYOUT', 'MARKET_REFUND', 'ACHIEVEMENT_REWARD');

-- CreateEnum
CREATE TYPE "SnapshotTrigger" AS ENUM ('OPENING', 'FORECAST', 'SCHEDULED', 'RESOLUTION');

-- CreateEnum
CREATE TYPE "StudyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StudyAccess" AS ENUM ('ORGANIZATION', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "StudyRole" AS ENUM ('LEAD', 'CONTRIBUTOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "NewsVerification" AS ENUM ('UNVERIFIED', 'VERIFIED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MARKET_CLOSING', 'MARKET_RESOLVED', 'FORECAST_SETTLED', 'CREDITS_GRANTED', 'WATCHLIST_ALERT', 'STUDY_INVITE', 'ORG_INVITE', 'ACHIEVEMENT_EARNED', 'SYSTEM');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "authId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'USER',
    "creditBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'VIEWER',
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Startup" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "website" TEXT,
    "logoUrl" TEXT,
    "sector" TEXT NOT NULL,
    "stage" "StartupStage" NOT NULL,
    "foundedYear" INTEGER,
    "headquarters" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Startup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "startupId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "resolutionCriteria" TEXT NOT NULL,
    "resolutionSource" TEXT,
    "category" TEXT,
    "openingBaseline" DOUBLE PRECISION NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'DRAFT',
    "visibility" "MarketVisibility" NOT NULL DEFAULT 'PUBLIC',
    "organizationId" TEXT,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "resolvesBy" TIMESTAMP(3),
    "yesCredits" INTEGER NOT NULL DEFAULT 0,
    "noCredits" INTEGER NOT NULL DEFAULT 0,
    "forecastCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Forecast" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" "ForecastSide" NOT NULL,
    "credits" INTEGER NOT NULL,
    "statedProbability" DOUBLE PRECISION,
    "status" "ForecastStatus" NOT NULL DEFAULT 'ACTIVE',
    "payout" INTEGER,
    "settledAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProbabilitySnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "trigger" "SnapshotTrigger" NOT NULL,
    "openingBaseline" DOUBLE PRECISION NOT NULL,
    "yesCredits" INTEGER NOT NULL,
    "noCredits" INTEGER NOT NULL,
    "communityAllocationShare" DOUBLE PRECISION,
    "calibratedProbability" DOUBLE PRECISION,
    "forecastCount" INTEGER NOT NULL,
    "uniqueForecasters" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProbabilitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resolution" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "outcome" "ResolutionOutcome" NOT NULL,
    "evidenceSummary" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settlementStatus" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "settledAt" TIMESTAMP(3),
    "settlementError" TEXT,

    CONSTRAINT "Resolution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTransaction" (
    "id" TEXT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "marketId" TEXT,
    "forecastId" TEXT,
    "resolutionId" TEXT,
    "actorId" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResearchStudy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "thesis" TEXT,
    "status" "StudyStatus" NOT NULL DEFAULT 'DRAFT',
    "access" "StudyAccess" NOT NULL DEFAULT 'ORGANIZATION',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyMembership" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "StudyRole" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyStartup" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "startupId" TEXT NOT NULL,
    "note" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyStartup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyMarket" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "note" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "organizationId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "startupId" TEXT,
    "marketId" TEXT,
    "note" TEXT,
    "alertThreshold" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" TEXT NOT NULL,
    "startupId" TEXT,
    "marketId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "verification" "NewsVerification" NOT NULL DEFAULT 'UNVERIFIED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT,
    "creditReward" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "organizationId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "data" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_authId_key" ON "User"("authId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMembership_userId_idx" ON "OrganizationMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Startup_slug_key" ON "Startup"("slug");

-- CreateIndex
CREATE INDEX "Startup_sector_idx" ON "Startup"("sector");

-- CreateIndex
CREATE INDEX "Startup_isPublished_name_idx" ON "Startup"("isPublished", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Market_slug_key" ON "Market"("slug");

-- CreateIndex
CREATE INDEX "Market_status_visibility_closesAt_idx" ON "Market"("status", "visibility", "closesAt");

-- CreateIndex
CREATE INDEX "Market_startupId_idx" ON "Market"("startupId");

-- CreateIndex
CREATE INDEX "Market_organizationId_idx" ON "Market"("organizationId");

-- CreateIndex
CREATE INDEX "Forecast_marketId_createdAt_idx" ON "Forecast"("marketId", "createdAt");

-- CreateIndex
CREATE INDEX "Forecast_userId_createdAt_idx" ON "Forecast"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Forecast_marketId_status_idx" ON "Forecast"("marketId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Forecast_userId_idempotencyKey_key" ON "Forecast"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ProbabilitySnapshot_marketId_capturedAt_idx" ON "ProbabilitySnapshot"("marketId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Resolution_marketId_key" ON "Resolution"("marketId");

-- CreateIndex
CREATE INDEX "Resolution_settlementStatus_idx" ON "Resolution"("settlementStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_sequence_key" ON "CreditTransaction"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTransaction_idempotencyKey_key" ON "CreditTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditTransaction_userId_sequence_idx" ON "CreditTransaction"("userId", "sequence");

-- CreateIndex
CREATE INDEX "CreditTransaction_marketId_idx" ON "CreditTransaction"("marketId");

-- CreateIndex
CREATE INDEX "CreditTransaction_forecastId_idx" ON "CreditTransaction"("forecastId");

-- CreateIndex
CREATE INDEX "CreditTransaction_resolutionId_idx" ON "CreditTransaction"("resolutionId");

-- CreateIndex
CREATE INDEX "CreditTransaction_type_createdAt_idx" ON "CreditTransaction"("type", "createdAt");

-- CreateIndex
CREATE INDEX "ResearchStudy_organizationId_status_idx" ON "ResearchStudy"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResearchStudy_organizationId_slug_key" ON "ResearchStudy"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "StudyMembership_userId_idx" ON "StudyMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyMembership_studyId_userId_key" ON "StudyMembership"("studyId", "userId");

-- CreateIndex
CREATE INDEX "StudyStartup_startupId_idx" ON "StudyStartup"("startupId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyStartup_studyId_startupId_key" ON "StudyStartup"("studyId", "startupId");

-- CreateIndex
CREATE INDEX "StudyMarket_marketId_idx" ON "StudyMarket"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyMarket_studyId_marketId_key" ON "StudyMarket"("studyId", "marketId");

-- CreateIndex
CREATE INDEX "Watchlist_ownerId_idx" ON "Watchlist"("ownerId");

-- CreateIndex
CREATE INDEX "Watchlist_organizationId_idx" ON "Watchlist"("organizationId");

-- CreateIndex
CREATE INDEX "WatchlistItem_startupId_idx" ON "WatchlistItem"("startupId");

-- CreateIndex
CREATE INDEX "WatchlistItem_marketId_idx" ON "WatchlistItem"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_startupId_key" ON "WatchlistItem"("watchlistId", "startupId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_marketId_key" ON "WatchlistItem"("watchlistId", "marketId");

-- CreateIndex
CREATE INDEX "NewsItem_startupId_publishedAt_idx" ON "NewsItem"("startupId", "publishedAt");

-- CreateIndex
CREATE INDEX "NewsItem_marketId_idx" ON "NewsItem"("marketId");

-- CreateIndex
CREATE INDEX "NewsItem_publishedAt_idx" ON "NewsItem"("publishedAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Achievement_key_key" ON "Achievement"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UserAchievement_userId_achievementId_key" ON "UserAchievement"("userId", "achievementId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Startup" ADD CONSTRAINT "Startup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProbabilitySnapshot" ADD CONSTRAINT "ProbabilitySnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_forecastId_fkey" FOREIGN KEY ("forecastId") REFERENCES "Forecast"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "Resolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMembership" ADD CONSTRAINT "StudyMembership_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMembership" ADD CONSTRAINT "StudyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyStartup" ADD CONSTRAINT "StudyStartup_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyStartup" ADD CONSTRAINT "StudyStartup_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyStartup" ADD CONSTRAINT "StudyStartup_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMarket" ADD CONSTRAINT "StudyMarket_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMarket" ADD CONSTRAINT "StudyMarket_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyMarket" ADD CONSTRAINT "StudyMarket_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written constraints (not expressible in schema.prisma).
-- Keep in sync with the comments in prisma/schema.prisma.
-- ---------------------------------------------------------------------------

-- Credits: balances can never go negative; ledger rows are non-zero and
-- record a non-negative running balance.
ALTER TABLE "User" ADD CONSTRAINT "User_creditBalance_nonnegative" CHECK ("creditBalance" >= 0);
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_amount_nonzero" CHECK ("amount" <> 0);
ALTER TABLE "CreditTransaction" ADD CONSTRAINT "CreditTransaction_balanceAfter_nonnegative" CHECK ("balanceAfter" >= 0);

-- Markets
ALTER TABLE "Market" ADD CONSTRAINT "Market_openingBaseline_range" CHECK ("openingBaseline" > 0 AND "openingBaseline" < 1);
ALTER TABLE "Market" ADD CONSTRAINT "Market_deadline_after_open" CHECK ("closesAt" > "opensAt");
ALTER TABLE "Market" ADD CONSTRAINT "Market_resolvesBy_after_close" CHECK ("resolvesBy" IS NULL OR "resolvesBy" >= "closesAt");
ALTER TABLE "Market" ADD CONSTRAINT "Market_private_requires_org" CHECK ("visibility" <> 'PRIVATE' OR "organizationId" IS NOT NULL);
ALTER TABLE "Market" ADD CONSTRAINT "Market_aggregates_nonnegative" CHECK ("yesCredits" >= 0 AND "noCredits" >= 0 AND "forecastCount" >= 0);

-- Forecasts
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_credits_positive" CHECK ("credits" > 0);
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_statedProbability_range" CHECK ("statedProbability" IS NULL OR ("statedProbability" >= 0 AND "statedProbability" <= 1));
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_payout_nonnegative" CHECK ("payout" IS NULL OR "payout" >= 0);

-- Snapshots
ALTER TABLE "ProbabilitySnapshot" ADD CONSTRAINT "ProbabilitySnapshot_ranges" CHECK (
  "openingBaseline" > 0 AND "openingBaseline" < 1
  AND ("communityAllocationShare" IS NULL OR ("communityAllocationShare" >= 0 AND "communityAllocationShare" <= 1))
  AND ("calibratedProbability" IS NULL OR ("calibratedProbability" >= 0 AND "calibratedProbability" <= 1))
  AND "yesCredits" >= 0 AND "noCredits" >= 0
);

-- Resolutions must cite evidence.
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_has_evidence" CHECK (cardinality("evidenceUrls") >= 1 AND length(btrim("evidenceSummary")) > 0);

-- Watchlist items point at exactly one target.
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_exactly_one_target" CHECK (num_nonnulls("startupId", "marketId") = 1);
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_alertThreshold_range" CHECK ("alertThreshold" IS NULL OR ("alertThreshold" > 0 AND "alertThreshold" <= 1));

ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_creditReward_nonnegative" CHECK ("creditReward" >= 0);

-- Append-only tables: the credit ledger and the audit log can never be
-- modified or deleted, only inserted into.
CREATE FUNCTION senzi_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CreditTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "CreditTransaction"
  FOR EACH ROW EXECUTE FUNCTION senzi_reject_mutation();

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION senzi_reject_mutation();
