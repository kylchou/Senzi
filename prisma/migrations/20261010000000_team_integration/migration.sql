-- Team integration: aligns the schema with the forecasting engine (Felix),
-- VC Intelligence (Darsh), and the community UI (Sahil).
-- Hand-written so existing rows survive: columns are renamed rather than
-- dropped, old enum values are mapped, and new required fields are backfilled.

-- ---------------------------------------------------------------------------
-- 1. Constraints that reference columns/values changed below
-- ---------------------------------------------------------------------------
ALTER TABLE "Market" DROP CONSTRAINT "Market_private_requires_org";
ALTER TABLE "Market" DROP CONSTRAINT "Market_openingBaseline_range";

-- ---------------------------------------------------------------------------
-- 2. Replace the first-draft VC tables with Darsh's study model
-- ---------------------------------------------------------------------------
DROP TABLE "StudyMembership";
DROP TABLE "StudyStartup";
DROP TABLE "StudyMarket";
DROP TABLE "WatchlistItem";
DROP TABLE "Watchlist";
DROP TABLE "ResearchStudy";
DROP TYPE "StudyAccess";
DROP TYPE "StudyRole";
DROP TYPE "StudyStatus";

-- ---------------------------------------------------------------------------
-- 3. Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "EstimateKind" AS ENUM ('ALLOCATION_SHARE', 'MARKET_PRICE');
CREATE TYPE "StudyVisibility" AS ENUM ('PUBLIC', 'ORGANIZATION', 'RESTRICTED');
CREATE TYPE "StudyStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'OPEN', 'CLOSED', 'RESOLVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "WatchlistItemType" AS ENUM ('STARTUP', 'STUDY');
CREATE TYPE "VcAlertType" AS ENUM ('FORECAST_MOVEMENT', 'DEADLINE_APPROACHING', 'STUDY_RESOLVED', 'STUDY_STATUS_CHANGED');

-- PRIVATE -> ORGANIZATION; UNLISTED is dropped (those markets become PUBLIC).
CREATE TYPE "MarketVisibility_new" AS ENUM ('PUBLIC', 'ORGANIZATION', 'RESTRICTED');
ALTER TABLE "Market" ALTER COLUMN "visibility" DROP DEFAULT;
ALTER TABLE "Market" ALTER COLUMN "visibility" TYPE "MarketVisibility_new" USING (
  CASE "visibility"::text WHEN 'PRIVATE' THEN 'ORGANIZATION' WHEN 'UNLISTED' THEN 'PUBLIC' ELSE "visibility"::text END
)::"MarketVisibility_new";
DROP TYPE "MarketVisibility";
ALTER TYPE "MarketVisibility_new" RENAME TO "MarketVisibility";
ALTER TABLE "Market" ALTER COLUMN "visibility" SET DEFAULT 'PUBLIC';

ALTER TYPE "ResolutionOutcome" RENAME VALUE 'CANCELLED' TO 'VOID';

ALTER TYPE "CreditTransactionType" ADD VALUE 'FORECAST_REVERSAL' AFTER 'FORECAST_STAKE';

-- Watchlist alerts moved to VcAlert.
CREATE TYPE "NotificationType_new" AS ENUM ('MARKET_CLOSING', 'MARKET_RESOLVED', 'FORECAST_SETTLED', 'CREDITS_GRANTED', 'STUDY_INVITE', 'ORG_INVITE', 'ACHIEVEMENT_EARNED', 'SYSTEM');
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType_new" USING (
  CASE "type"::text WHEN 'WATCHLIST_ALERT' THEN 'SYSTEM' ELSE "type"::text END
)::"NotificationType_new";
DROP TYPE "NotificationType";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";

-- Old snapshot triggers stay readable until ProbabilitySnapshot is copied below.
ALTER TYPE "SnapshotTrigger" RENAME TO "SnapshotTrigger_old";
CREATE TYPE "SnapshotTrigger" AS ENUM ('OPENING', 'FORECAST', 'MODEL_UPDATE', 'SETTLEMENT');

-- ---------------------------------------------------------------------------
-- 4. Column changes on existing tables
-- ---------------------------------------------------------------------------
ALTER TABLE "Startup" RENAME COLUMN "sector" TO "industry";
ALTER TABLE "Startup" RENAME COLUMN "website" TO "websiteUrl";
ALTER INDEX "Startup_sector_idx" RENAME TO "Startup_industry_idx";

ALTER TABLE "NewsItem" RENAME COLUMN "sourceName" TO "publisher";
ALTER TABLE "NewsItem" RENAME COLUMN "sourceUrl" TO "url";

ALTER TABLE "Market" RENAME COLUMN "resolutionCriteria" TO "yesCriteria";
ALTER TABLE "Market"
  ADD COLUMN "noCriteria" TEXT NOT NULL DEFAULT 'Resolves NO if the YES criteria are not met by the deadline.',
  ADD COLUMN "baselineMethodology" TEXT,
  ADD COLUMN "baselineSetAt" TIMESTAMP(3),
  ADD COLUMN "modelValue" DOUBLE PRECISION,
  ADD COLUMN "modelVersion" TEXT,
  ADD COLUMN "modelInputsNote" TEXT,
  ADD COLUMN "modelUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "minForecastCredits" INTEGER,
  ADD COLUMN "maxForecastCredits" INTEGER,
  ALTER COLUMN "openingBaseline" DROP NOT NULL;
ALTER TABLE "Market" ALTER COLUMN "noCriteria" DROP DEFAULT;
UPDATE "Market" SET "baselineMethodology" = 'Admin estimate', "baselineSetAt" = "opensAt" WHERE "openingBaseline" IS NOT NULL;

-- Forecasts: per-market sequence plus the fields the engine records at entry.
ALTER TABLE "Forecast"
  ADD COLUMN "sequence" INTEGER,
  ADD COLUMN "requestHash" TEXT,
  ADD COLUMN "verifiedAtEntry" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "entry" JSONB,
  ADD COLUMN "fill" JSONB;
UPDATE "Forecast" AS f SET
  "sequence" = ordered.seq,
  "requestHash" = 'legacy:' || f."id",
  "entry" = '{}'::jsonb
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "marketId" ORDER BY "createdAt", "id") AS seq FROM "Forecast"
) AS ordered
WHERE ordered."id" = f."id";
ALTER TABLE "Forecast"
  ALTER COLUMN "sequence" SET NOT NULL,
  ALTER COLUMN "requestHash" SET NOT NULL,
  ALTER COLUMN "entry" SET NOT NULL;
DROP INDEX "Forecast_marketId_createdAt_idx";
CREATE UNIQUE INDEX "Forecast_marketId_sequence_key" ON "Forecast"("marketId", "sequence");

ALTER TABLE "Resolution" ADD COLUMN "settlementModelId" TEXT;

-- ---------------------------------------------------------------------------
-- 5. New tables (generated by Prisma from schema.prisma)
-- ---------------------------------------------------------------------------
CREATE TABLE "StartupFact" (
    "id" TEXT NOT NULL,
    "startupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StartupFact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketSource" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publisher" TEXT,
    "publishedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MarketSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "trigger" "SnapshotTrigger" NOT NULL,
    "forecastId" TEXT,
    "openingBaseline" DOUBLE PRECISION,
    "modelValue" DOUBLE PRECISION,
    "yesCredits" INTEGER NOT NULL,
    "noCredits" INTEGER NOT NULL,
    "allocationShare" DOUBLE PRECISION,
    "generalEstimate" DOUBLE PRECISION,
    "specializedEstimate" DOUBLE PRECISION,
    "estimateRuleId" TEXT,
    "estimateKind" "EstimateKind",
    "calibratedProbability" DOUBLE PRECISION,
    "forecastCount" INTEGER NOT NULL,
    "forecasterCount" INTEGER NOT NULL,
    "specializedForecasters" INTEGER NOT NULL DEFAULT 0,
    "specializedCredits" INTEGER NOT NULL DEFAULT 0,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchStudy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "startupId" TEXT NOT NULL,
    "marketId" TEXT,
    "question" TEXT NOT NULL,
    "yesCriteria" TEXT NOT NULL,
    "noCriteria" TEXT NOT NULL,
    "context" TEXT,
    "baselineValue" DOUBLE PRECISION,
    "baselineMethodology" TEXT,
    "deadline" TIMESTAMP(3) NOT NULL,
    "visibility" "StudyVisibility" NOT NULL DEFAULT 'ORGANIZATION',
    "status" "StudyStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" TEXT,
    "cancellationReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedOutcome" "ResolutionOutcome",
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchStudy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudySource" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "publisher" TEXT,
    "publishedAt" TIMESTAMP(3),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StudySource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyParticipant" (
    "studyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyParticipant_pkey" PRIMARY KEY ("studyId","userId")
);

CREATE TABLE "StudyEvent" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "fromStatus" "StudyStatus",
    "toStatus" "StudyStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StudyNote" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "type" "WatchlistItemType" NOT NULL,
    "startupId" TEXT,
    "studyId" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VcAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "VcAlertType" NOT NULL,
    "studyId" TEXT,
    "startupId" TEXT,
    "marketId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VcAlert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VcAlertReceipt" (
    "alertId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VcAlertReceipt_pkey" PRIMARY KEY ("alertId","userId")
);

CREATE TABLE "VcReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VcReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StartupFact_startupId_idx" ON "StartupFact"("startupId");

CREATE INDEX "MarketSource_marketId_position_idx" ON "MarketSource"("marketId", "position");

CREATE INDEX "MarketSnapshot_marketId_recordedAt_idx" ON "MarketSnapshot"("marketId", "recordedAt");

CREATE UNIQUE INDEX "MarketSnapshot_marketId_sequence_key" ON "MarketSnapshot"("marketId", "sequence");

CREATE UNIQUE INDEX "ResearchStudy_marketId_key" ON "ResearchStudy"("marketId");

CREATE INDEX "ResearchStudy_organizationId_status_idx" ON "ResearchStudy"("organizationId", "status");

CREATE INDEX "ResearchStudy_visibility_status_idx" ON "ResearchStudy"("visibility", "status");

CREATE INDEX "ResearchStudy_startupId_idx" ON "ResearchStudy"("startupId");

CREATE INDEX "StudySource_studyId_idx" ON "StudySource"("studyId");

CREATE INDEX "StudyParticipant_userId_idx" ON "StudyParticipant"("userId");

CREATE INDEX "StudyEvent_studyId_createdAt_idx" ON "StudyEvent"("studyId", "createdAt");

CREATE INDEX "StudyNote_studyId_createdAt_idx" ON "StudyNote"("studyId", "createdAt");

CREATE UNIQUE INDEX "Watchlist_organizationId_name_key" ON "Watchlist"("organizationId", "name");

CREATE UNIQUE INDEX "WatchlistItem_watchlistId_startupId_key" ON "WatchlistItem"("watchlistId", "startupId");

CREATE UNIQUE INDEX "WatchlistItem_watchlistId_studyId_key" ON "WatchlistItem"("watchlistId", "studyId");

CREATE INDEX "VcAlert_organizationId_createdAt_idx" ON "VcAlert"("organizationId", "createdAt");

CREATE UNIQUE INDEX "VcAlert_organizationId_dedupeKey_key" ON "VcAlert"("organizationId", "dedupeKey");

CREATE INDEX "VcReport_organizationId_createdAt_idx" ON "VcReport"("organizationId", "createdAt");

ALTER TABLE "StartupFact" ADD CONSTRAINT "StartupFact_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketSource" ADD CONSTRAINT "MarketSource_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudySource" ADD CONSTRAINT "StudySource_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyParticipant" ADD CONSTRAINT "StudyParticipant_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyParticipant" ADD CONSTRAINT "StudyParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyParticipant" ADD CONSTRAINT "StudyParticipant_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudyEvent" ADD CONSTRAINT "StudyEvent_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyEvent" ADD CONSTRAINT "StudyEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StudyNote" ADD CONSTRAINT "StudyNote_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyNote" ADD CONSTRAINT "StudyNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StudyNote" ADD CONSTRAINT "StudyNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Watchlist" ADD CONSTRAINT "Watchlist_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VcAlert" ADD CONSTRAINT "VcAlert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VcAlertReceipt" ADD CONSTRAINT "VcAlertReceipt_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "VcAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VcAlertReceipt" ADD CONSTRAINT "VcAlertReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VcReport" ADD CONSTRAINT "VcReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VcReport" ADD CONSTRAINT "VcReport_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VcReport" ADD CONSTRAINT "VcReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6. Carry existing data into the new tables
-- ---------------------------------------------------------------------------
INSERT INTO "MarketSource" ("id", "marketId", "title", "url", "position")
SELECT 'ms_' || "id", "id", "resolutionSource", '', 0
FROM "Market" WHERE "resolutionSource" IS NOT NULL;
ALTER TABLE "Market" DROP COLUMN "resolutionSource";

INSERT INTO "MarketSnapshot" (
  "id", "marketId", "sequence", "trigger", "openingBaseline", "yesCredits", "noCredits",
  "allocationShare", "calibratedProbability", "forecastCount", "forecasterCount", "recordedAt"
)
SELECT
  "id", "marketId",
  row_number() OVER (PARTITION BY "marketId" ORDER BY "capturedAt", "id"),
  (CASE "trigger"::text WHEN 'SCHEDULED' THEN 'MODEL_UPDATE' WHEN 'RESOLUTION' THEN 'SETTLEMENT' ELSE "trigger"::text END)::"SnapshotTrigger",
  "openingBaseline", "yesCredits", "noCredits",
  "communityAllocationShare", "calibratedProbability", "forecastCount", "uniqueForecasters", "capturedAt"
FROM "ProbabilitySnapshot";
DROP TABLE "ProbabilitySnapshot";
DROP TYPE "SnapshotTrigger_old";

-- ---------------------------------------------------------------------------
-- 7. Hand-written constraints (keep in sync with schema.prisma comments)
-- ---------------------------------------------------------------------------
ALTER TABLE "Market" ADD CONSTRAINT "Market_nonpublic_requires_org" CHECK ("visibility" = 'PUBLIC' OR "organizationId" IS NOT NULL);
ALTER TABLE "Market" ADD CONSTRAINT "Market_openingBaseline_range" CHECK ("openingBaseline" IS NULL OR ("openingBaseline" > 0 AND "openingBaseline" < 1));
ALTER TABLE "Market" ADD CONSTRAINT "Market_modelValue_range" CHECK ("modelValue" IS NULL OR ("modelValue" >= 0 AND "modelValue" <= 1));
ALTER TABLE "Market" ADD CONSTRAINT "Market_forecast_limits" CHECK (
  ("minForecastCredits" IS NULL OR "minForecastCredits" > 0)
  AND ("maxForecastCredits" IS NULL OR "maxForecastCredits" >= COALESCE("minForecastCredits", 1))
);

ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_sequence_positive" CHECK ("sequence" > 0);

ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_ranges" CHECK (
  "sequence" > 0
  AND ("openingBaseline" IS NULL OR ("openingBaseline" > 0 AND "openingBaseline" < 1))
  AND ("modelValue" IS NULL OR ("modelValue" >= 0 AND "modelValue" <= 1))
  AND ("allocationShare" IS NULL OR ("allocationShare" >= 0 AND "allocationShare" <= 1))
  AND ("generalEstimate" IS NULL OR ("generalEstimate" >= 0 AND "generalEstimate" <= 1))
  AND ("specializedEstimate" IS NULL OR ("specializedEstimate" >= 0 AND "specializedEstimate" <= 1))
  AND ("calibratedProbability" IS NULL OR ("calibratedProbability" >= 0 AND "calibratedProbability" <= 1))
  AND "yesCredits" >= 0 AND "noCredits" >= 0
);

ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_baseline_range" CHECK ("baselineValue" IS NULL OR ("baselineValue" > 0 AND "baselineValue" < 1));
ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_version_positive" CHECK ("version" >= 1);

ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_target_matches_type" CHECK (
  ("type" = 'STARTUP' AND "startupId" IS NOT NULL AND "studyId" IS NULL)
  OR ("type" = 'STUDY' AND "studyId" IS NOT NULL AND "startupId" IS NULL)
);

-- Market snapshots and study events are history and can't be edited. Unlike the
-- ledger they may still be removed when their market/study/org is deleted.
CREATE TRIGGER "MarketSnapshot_immutable"
  BEFORE UPDATE ON "MarketSnapshot"
  FOR EACH ROW EXECUTE FUNCTION senzi_reject_mutation();

CREATE TRIGGER "StudyEvent_immutable"
  BEFORE UPDATE ON "StudyEvent"
  FOR EACH ROW EXECUTE FUNCTION senzi_reject_mutation();
