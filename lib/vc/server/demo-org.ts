import "server-only";
import { AccountType, OrgRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { DEMO_ORG_ID } from "../constants";

/**
 * Adds a verified VC account that has no firm yet to the shared demo firm, so a new
 * account opens onto the PostHog starter data. Does nothing unless the demo firm exists
 * (it is created by lib/model/cli/seed-real-markets.ts), so real deployments are unaffected.
 * Returns true when the user is a member afterwards.
 */
export async function joinDemoOrgIfNew(userId: string): Promise<boolean> {
  const [user, org] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { accountType: true, accountVerifiedAt: true } }),
    db.organization.findUnique({ where: { id: DEMO_ORG_ID }, select: { id: true } }),
  ]);
  if (!org || user?.accountType !== AccountType.VC || !user.accountVerifiedAt) return false;
  await db.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: DEMO_ORG_ID, userId } },
    create: { organizationId: DEMO_ORG_ID, userId, role: OrgRole.ANALYST },
    update: {},
  });
  return true;
}
