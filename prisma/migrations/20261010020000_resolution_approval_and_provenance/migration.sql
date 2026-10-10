-- Two-admin resolution approval, resolution evidence with provenance, source
-- licensing, verification attribution, demo labelling, and rate limiting.

-- CreateEnum
CREATE TYPE "VoidReason" AS ENUM ('CANCELLED', 'AMBIGUOUS', 'UNVERIFIABLE', 'INVALID_MARKET', 'OTHER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('COMPANY_ANNOUNCEMENT', 'REGULATORY_FILING', 'NEWS_REPORT', 'DATA_PROVIDER', 'OFFICIAL_RECORD', 'SOCIAL_MEDIA', 'OTHER');

-- CreateEnum
CREATE TYPE "SourceLicense" AS ENUM ('LINK_ONLY', 'ATTRIBUTION_REQUIRED', 'OPEN_LICENSE', 'PERMISSION_GRANTED');

-- AlterTable
ALTER TABLE "Startup" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StartupFact" ADD COLUMN     "license" "SourceLicense" NOT NULL DEFAULT 'LINK_ONLY',
ADD COLUMN     "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sourceType" "SourceType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- AlterTable
ALTER TABLE "MarketSource" ADD COLUMN     "license" "SourceLicense" NOT NULL DEFAULT 'LINK_ONLY',
ADD COLUMN     "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sourceType" "SourceType" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "Resolution" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "correctionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentProposalId" TEXT,
ADD COLUMN     "settlementAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "settlementStartedAt" TIMESTAMP(3),
ADD COLUMN     "voidReason" "VoidReason";

-- AlterTable
ALTER TABLE "NewsItem" ADD COLUMN     "license" "SourceLicense" NOT NULL DEFAULT 'LINK_ONLY',
ADD COLUMN     "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT;

-- CreateTable
CREATE TABLE "ResolutionProposal" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "correctsId" TEXT,
    "outcome" "ResolutionOutcome" NOT NULL,
    "voidReason" "VoidReason",
    "evidenceSummary" TEXT NOT NULL,
    "correctionReason" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposedById" TEXT NOT NULL,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "ResolutionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResolutionEvidence" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL DEFAULT 'OTHER',
    "license" "SourceLicense" NOT NULL DEFAULT 'LINK_ONLY',
    "publisher" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "submittedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResolutionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE INDEX "ResolutionProposal_marketId_proposedAt_idx" ON "ResolutionProposal"("marketId", "proposedAt");

-- CreateIndex
CREATE INDEX "ResolutionProposal_status_proposedAt_idx" ON "ResolutionProposal"("status", "proposedAt");

-- CreateIndex
CREATE INDEX "ResolutionEvidence_proposalId_idx" ON "ResolutionEvidence"("proposalId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_windowStart_idx" ON "RateLimitBucket"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "Resolution_currentProposalId_key" ON "Resolution"("currentProposalId");

-- AddForeignKey
ALTER TABLE "StartupFact" ADD CONSTRAINT "StartupFact_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_currentProposalId_fkey" FOREIGN KEY ("currentProposalId") REFERENCES "ResolutionProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "Resolution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_proposedById_fkey" FOREIGN KEY ("proposedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionEvidence" ADD CONSTRAINT "ResolutionEvidence_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "ResolutionProposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResolutionEvidence" ADD CONSTRAINT "ResolutionEvidence_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill existing rows so the new rules hold
-- ---------------------------------------------------------------------------

-- Resolutions recorded before VOID reasons existed.
UPDATE "Resolution" SET "voidReason" = 'OTHER' WHERE "outcome" = 'VOID' AND "voidReason" IS NULL;

-- Give every existing resolution an approved proposal so its history reads the same way.
INSERT INTO "ResolutionProposal" ("id", "marketId", "outcome", "voidReason", "evidenceSummary", "status", "proposedById", "proposedAt", "reviewedAt", "reviewNote")
SELECT 'legacy_' || r."id", r."marketId", r."outcome", r."voidReason", r."evidenceSummary", 'APPROVED',
       r."resolvedById", r."resolvedAt", r."resolvedAt", 'Recorded before two-admin approval existed'
FROM "Resolution" r
WHERE r."resolvedById" IS NOT NULL;

INSERT INTO "ResolutionEvidence" ("id", "proposalId", "title", "url", "submittedById", "retrievedAt", "createdAt")
SELECT 'legacy_' || r."id" || '_' || u.ord, 'legacy_' || r."id", u.url, u.url, r."resolvedById", r."resolvedAt", r."resolvedAt"
FROM "Resolution" r, unnest(r."evidenceUrls") WITH ORDINALITY AS u(url, ord)
WHERE r."resolvedById" IS NOT NULL;

UPDATE "Resolution" SET "currentProposalId" = 'legacy_' || "id", "approvedAt" = "resolvedAt"
WHERE "resolvedById" IS NOT NULL;

-- Items marked verified before we recorded when.
UPDATE "StartupFact" SET "verifiedAt" = "updatedAt" WHERE "verified" AND "verifiedAt" IS NULL;
UPDATE "NewsItem" SET "verifiedAt" = "updatedAt" WHERE "verification" = 'VERIFIED' AND "verifiedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- Hand-written rules (keep in sync with schema.prisma comments)
-- ---------------------------------------------------------------------------

-- A VOID outcome always says why; other outcomes never carry a void reason.
ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_void_reason" CHECK (("outcome" = 'VOID') = ("voidReason" IS NOT NULL));
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_void_reason" CHECK (("outcome" = 'VOID') = ("voidReason" IS NOT NULL));

ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_has_summary" CHECK (length(btrim("evidenceSummary")) > 0);
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_correction_reason" CHECK (
  "correctsId" IS NULL OR length(btrim(coalesce("correctionReason", ''))) > 0
);
ALTER TABLE "ResolutionProposal" ADD CONSTRAINT "ResolutionProposal_reviewed" CHECK (
  "status" = 'PROPOSED' OR ("reviewedById" IS NOT NULL OR "id" LIKE 'legacy\_%') AND "reviewedAt" IS NOT NULL
);

ALTER TABLE "Resolution" ADD CONSTRAINT "Resolution_counters_nonnegative" CHECK ("correctionCount" >= 0 AND "settlementAttempts" >= 0);
ALTER TABLE "RateLimitBucket" ADD CONSTRAINT "RateLimitBucket_count_nonnegative" CHECK ("count" >= 0);

ALTER TABLE "StartupFact" ADD CONSTRAINT "StartupFact_verified_has_time" CHECK (NOT "verified" OR "verifiedAt" IS NOT NULL);
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_verified_has_time" CHECK ("verification" <> 'VERIFIED' OR "verifiedAt" IS NOT NULL);

-- Evidence is history: never edited or deleted.
CREATE TRIGGER "ResolutionEvidence_append_only"
  BEFORE UPDATE OR DELETE ON "ResolutionEvidence"
  FOR EACH ROW EXECUTE FUNCTION senzi_reject_mutation();

-- Proposals are never deleted, and what was proposed can't be rewritten;
-- only the review fields (status, reviewer, time, note) change, once.
CREATE FUNCTION senzi_guard_resolution_proposal() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ResolutionProposal is append-only (DELETE rejected)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."marketId" IS DISTINCT FROM OLD."marketId"
     OR NEW."correctsId" IS DISTINCT FROM OLD."correctsId"
     OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
     OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason"
     OR NEW."evidenceSummary" IS DISTINCT FROM OLD."evidenceSummary"
     OR NEW."correctionReason" IS DISTINCT FROM OLD."correctionReason"
     OR NEW."proposedById" IS DISTINCT FROM OLD."proposedById"
     OR NEW."proposedAt" IS DISTINCT FROM OLD."proposedAt" THEN
    RAISE EXCEPTION 'A resolution proposal can''t be rewritten; propose a correction instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" <> 'PROPOSED' THEN
    RAISE EXCEPTION 'A reviewed resolution proposal can''t change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResolutionProposal_guard"
  BEFORE UPDATE OR DELETE ON "ResolutionProposal"
  FOR EACH ROW EXECUTE FUNCTION senzi_guard_resolution_proposal();
