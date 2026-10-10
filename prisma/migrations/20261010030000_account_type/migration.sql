-- Account types: VC (sponsor) or TRADER, chosen once at signup.

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('VC', 'TRADER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountType" "AccountType";

-- Backfill: members of a VC organization (pending invites included) are VCs,
-- everyone else is a trader.
UPDATE "User" u SET "accountType" = 'VC'
WHERE EXISTS (SELECT 1 FROM "OrganizationMembership" m WHERE m."userId" = u."id");
UPDATE "User" SET "accountType" = 'TRADER' WHERE "accountType" IS NULL;
