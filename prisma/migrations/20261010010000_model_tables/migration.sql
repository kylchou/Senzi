-- Baseline model tables (Felix's proposal in docs/model-schema-proposal.md).

-- CreateEnum
CREATE TYPE "ModelSource" AS ENUM ('NPM', 'PYPISTATS', 'GITHUB', 'SEC_EDGAR', 'GREENHOUSE', 'ASHBY', 'WORKABLE', 'TRANCO', 'HN_ALGOLIA', 'SPONSOR');

-- CreateEnum
CREATE TYPE "DataProvenance" AS ENUM ('SCRAPED', 'SPONSOR_PROVIDED');

-- CreateEnum
CREATE TYPE "BaselineStatus" AS ENUM ('OK', 'INSUFFICIENT_DATA', 'OBSERVED');

-- CreateTable
CREATE TABLE "ModelDataPoint" (
    "id" TEXT NOT NULL,
    "startupId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "source" "ModelSource" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "provenance" "DataProvenance" NOT NULL,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "organizationId" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelDataPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelQuestionSpec" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "windowEnd" DATE NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 7,
    "resolutionSource" "ModelSource" NOT NULL,
    "resolutionSourceUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelQuestionSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelBaselineSnapshot" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "status" "BaselineStatus" NOT NULL,
    "probability" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "confidence" TEXT,
    "asOf" TIMESTAMP(3) NOT NULL,
    "dataThrough" DATE,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "method" JSONB NOT NULL,
    "inputsUsed" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "missing" TEXT[],
    "notes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelBaselineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "modelVersion" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "report" JSONB NOT NULL,

    CONSTRAINT "ModelRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModelDataPoint_startupId_metricId_periodEnd_idx" ON "ModelDataPoint"("startupId", "metricId", "periodEnd");

-- CreateIndex
CREATE INDEX "ModelDataPoint_availableAt_idx" ON "ModelDataPoint"("availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelDataPoint_startupId_metricId_source_periodStart_period_key" ON "ModelDataPoint"("startupId", "metricId", "source", "periodStart", "periodEnd", "organizationId") NULLS NOT DISTINCT;

-- CreateIndex
CREATE UNIQUE INDEX "ModelQuestionSpec_marketId_key" ON "ModelQuestionSpec"("marketId");

-- CreateIndex
CREATE INDEX "ModelBaselineSnapshot_marketId_createdAt_idx" ON "ModelBaselineSnapshot"("marketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelBaselineSnapshot_marketId_inputsHash_key" ON "ModelBaselineSnapshot"("marketId", "inputsHash");

-- CreateIndex
CREATE INDEX "ModelRun_kind_startedAt_idx" ON "ModelRun"("kind", "startedAt");

-- AddForeignKey
ALTER TABLE "ModelDataPoint" ADD CONSTRAINT "ModelDataPoint_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelDataPoint" ADD CONSTRAINT "ModelDataPoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelDataPoint" ADD CONSTRAINT "ModelDataPoint_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelQuestionSpec" ADD CONSTRAINT "ModelQuestionSpec_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelBaselineSnapshot" ADD CONSTRAINT "ModelBaselineSnapshot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written rules (keep in sync with schema.prisma comments)
-- ---------------------------------------------------------------------------

-- Scraped rows are public and real; sponsor rows come from the SPONSOR source
-- and belong to an organization.
ALTER TABLE "ModelDataPoint" ADD CONSTRAINT "ModelDataPoint_provenance_rules" CHECK (
  ("provenance" = 'SCRAPED' AND "simulated" = false AND "organizationId" IS NULL AND "source" <> 'SPONSOR')
  OR ("provenance" = 'SPONSOR_PROVIDED' AND "source" = 'SPONSOR' AND "organizationId" IS NOT NULL)
);
ALTER TABLE "ModelDataPoint" ADD CONSTRAINT "ModelDataPoint_periods_ordered" CHECK (
  "periodEnd" >= "periodStart" AND "availableAt" >= "periodStart"
);

ALTER TABLE "ModelQuestionSpec" ADD CONSTRAINT "ModelQuestionSpec_windowDays_positive" CHECK ("windowDays" > 0);

ALTER TABLE "ModelBaselineSnapshot" ADD CONSTRAINT "ModelBaselineSnapshot_ranges" CHECK (
  ("probability" IS NULL OR ("probability" >= 0 AND "probability" <= 1))
  AND ("low" IS NULL OR ("low" >= 0 AND "low" <= 1))
  AND ("high" IS NULL OR ("high" >= 0 AND "high" <= 1))
  AND ("low" IS NULL OR "high" IS NULL OR "low" <= "high")
  AND ("status" <> 'INSUFFICIENT_DATA' OR "probability" IS NULL)
);

-- The machine-checkable resolution source is fixed once the market has opened.
CREATE FUNCTION senzi_lock_question_spec_source() RETURNS trigger AS $$
DECLARE
  opened timestamp(3);
BEGIN
  IF NEW."resolutionSource" IS DISTINCT FROM OLD."resolutionSource"
     OR NEW."resolutionSourceUrl" IS DISTINCT FROM OLD."resolutionSourceUrl"
     OR NEW."marketId" IS DISTINCT FROM OLD."marketId" THEN
    SELECT "opensAt" INTO opened FROM "Market" WHERE "id" = OLD."marketId";
    IF opened IS NOT NULL AND opened <= now() THEN
      RAISE EXCEPTION 'ModelQuestionSpec resolution source is locked once the market has opened'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ModelQuestionSpec_lock_source"
  BEFORE UPDATE ON "ModelQuestionSpec"
  FOR EACH ROW EXECUTE FUNCTION senzi_lock_question_spec_source();
