-- Account verification: traders by verified email, VCs by admin review or a firm invite.
-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VcVerificationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firmName" TEXT NOT NULL,
    "firmWebsite" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "workEmail" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "note" TEXT,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VcVerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VcVerificationRequest_status_createdAt_idx" ON "VcVerificationRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "VcVerificationRequest_userId_createdAt_idx" ON "VcVerificationRequest"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "VcVerificationRequest" ADD CONSTRAINT "VcVerificationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VcVerificationRequest" ADD CONSTRAINT "VcVerificationRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: existing VCs are firm members and existing traders signed up with a
-- verified email, so everyone who already has a type counts as verified.
UPDATE "User" SET "accountVerifiedAt" = CURRENT_TIMESTAMP WHERE "accountType" IS NOT NULL;
