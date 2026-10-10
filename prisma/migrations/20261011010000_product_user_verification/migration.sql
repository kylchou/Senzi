-- Verified product users: access codes and screenshots, and markets only they can trade.
-- CreateEnum
CREATE TYPE "ProductVerificationMethod" AS ENUM ('ACCESS_CODE', 'SCREENSHOT');

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "verifiedUsersOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProductUserVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startupId" TEXT NOT NULL,
    "method" "ProductVerificationMethod" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "accessCodeId" TEXT,
    "screenshot" BYTEA,
    "screenshotType" TEXT,
    "note" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductUserVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAccessCode" (
    "id" TEXT NOT NULL,
    "startupId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "label" TEXT,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAccessCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductUserVerification_userId_startupId_status_idx" ON "ProductUserVerification"("userId", "startupId", "status");

-- CreateIndex
CREATE INDEX "ProductUserVerification_status_createdAt_idx" ON "ProductUserVerification"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAccessCode_codeHash_key" ON "ProductAccessCode"("codeHash");

-- CreateIndex
CREATE INDEX "ProductAccessCode_startupId_createdAt_idx" ON "ProductAccessCode"("startupId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductUserVerification" ADD CONSTRAINT "ProductUserVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUserVerification" ADD CONSTRAINT "ProductUserVerification_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUserVerification" ADD CONSTRAINT "ProductUserVerification_accessCodeId_fkey" FOREIGN KEY ("accessCodeId") REFERENCES "ProductAccessCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductUserVerification" ADD CONSTRAINT "ProductUserVerification_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccessCode" ADD CONSTRAINT "ProductAccessCode_startupId_fkey" FOREIGN KEY ("startupId") REFERENCES "Startup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAccessCode" ADD CONSTRAINT "ProductAccessCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

