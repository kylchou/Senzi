-- Who a study's question is open to, and its prize pool.

-- AlterEnum
ALTER TYPE "CreditTransactionType" ADD VALUE 'PRIZE_POOL_PAYOUT';

-- AlterTable
ALTER TABLE "ResearchStudy" ADD COLUMN "openToPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "openToVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "prizePoolCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "prizeDistributedAt" TIMESTAMP(3);

-- A question is open to at least one audience; prize pools are whole, non-negative credits.
ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_audience_check" CHECK ("openToPublic" OR "openToVerified");
ALTER TABLE "ResearchStudy" ADD CONSTRAINT "ResearchStudy_prize_pool_check" CHECK ("prizePoolCredits" >= 0 AND "prizePoolCredits" <= 10000000);
