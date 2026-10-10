-- The model sets each study's opening line (see lib/vc/services/opening-line.ts).

-- CreateEnum
CREATE TYPE "StudyEstimateStatus" AS ENUM ('OK', 'INSUFFICIENT_DATA', 'NOT_MEASURABLE');

-- CreateTable
CREATE TABLE "StudyModelEstimate" (
    "id" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "status" "StudyEstimateStatus" NOT NULL,
    "metricId" TEXT,
    "threshold" DOUBLE PRECISION,
    "targetDate" DATE,
    "probability" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "confidence" TEXT,
    "modelVersion" TEXT NOT NULL,
    "inputsHash" TEXT,
    "methodology" TEXT,
    "notes" TEXT[],
    "observations" JSONB NOT NULL DEFAULT '[]',
    "inputsUsed" JSONB NOT NULL DEFAULT '[]',
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "calculatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyModelEstimate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "StudyModelEstimate_probability_check" CHECK ("probability" IS NULL OR ("probability" > 0 AND "probability" < 1)),
    CONSTRAINT "StudyModelEstimate_ok_check" CHECK ("status" <> 'OK' OR ("probability" IS NOT NULL AND "metricId" IS NOT NULL AND "methodology" IS NOT NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyModelEstimate_studyId_key" ON "StudyModelEstimate"("studyId");

-- AddForeignKey
ALTER TABLE "StudyModelEstimate" ADD CONSTRAINT "StudyModelEstimate_studyId_fkey" FOREIGN KEY ("studyId") REFERENCES "ResearchStudy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
