import type { Prisma } from "@/generated/prisma/client";
import { DataProvenance, MarketStatus, MarketVisibility, OrgRole } from "@/generated/prisma/enums";
import { forbidden, notFound } from "@/lib/api-response";
import { db } from "@/lib/db";
import { ORG_ROLE_RANK, type SessionUser } from "@/lib/types";

/**
 * Server-side authorization rules shared across the app.
 *
 * Organization isolation: VC organization data is visible only to members of
 * that org. Platform admins do NOT bypass this; they manage the public
 * community platform, not firms' private research.
 *
 * Non-members get NOT_FOUND rather than FORBIDDEN so private resources do not
 * reveal that they exist.
 *
 * Study, note, report, and watchlist rules live with VC Intelligence in
 * lib/vc/permissions.ts and build on requireOrgRole below.
 */

// ---------------------------------------------------------------------------
// Organization roles
// ---------------------------------------------------------------------------

export function hasOrgRole(role: OrgRole | null | undefined, minimum: OrgRole): boolean {
  return role != null && ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minimum];
}

export async function getOrgRole(userId: string, organizationId: string): Promise<OrgRole | null> {
  const membership = await db.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

/**
 * Throws NOT_FOUND for non-members and FORBIDDEN for members below `minimum`.
 * Returns the caller's role.
 */
export async function requireOrgRole(
  user: Pick<SessionUser, "id">,
  organizationId: string,
  minimum: OrgRole = OrgRole.VIEWER,
): Promise<OrgRole> {
  const role = await getOrgRole(user.id, organizationId);
  if (!role) throw notFound("Organization");
  if (!hasOrgRole(role, minimum)) throw forbidden(`Requires the ${minimum} role or higher`);
  return role;
}

export type MemberChange =
  | { kind: "add"; newRole: OrgRole }
  | { kind: "changeRole"; targetRole: OrgRole; newRole: OrgRole }
  | { kind: "remove"; targetRole: OrgRole };

/**
 * Who may change whose membership:
 * - OWNER: anything (last-owner protection is enforced separately).
 * - ADMIN: add/change/remove ANALYST and VIEWER members only, and can only
 *   assign ANALYST or VIEWER.
 * - ANALYST / VIEWER: nothing (they may still leave).
 */
export function canManageMember(actorRole: OrgRole, change: MemberChange): boolean {
  if (actorRole === OrgRole.OWNER) return true;
  if (actorRole !== OrgRole.ADMIN) return false;
  const belowAdmin = (role: OrgRole) => ORG_ROLE_RANK[role] < ORG_ROLE_RANK[OrgRole.ADMIN];
  switch (change.kind) {
    case "add":
      return belowAdmin(change.newRole);
    case "changeRole":
      return belowAdmin(change.targetRole) && belowAdmin(change.newRole);
    case "remove":
      return belowAdmin(change.targetRole);
  }
}

// ---------------------------------------------------------------------------
// Markets & startups
// ---------------------------------------------------------------------------

/**
 * Use these in every public (community) query so private, draft, and
 * unpublished records can never leak through a public API.
 */
export const PUBLIC_MARKET_WHERE = {
  visibility: MarketVisibility.PUBLIC,
  status: { not: MarketStatus.DRAFT },
  startup: { isPublished: true },
} satisfies Prisma.MarketWhereInput;

export const PUBLIC_STARTUP_WHERE = { isPublished: true } satisfies Prisma.StartupWhereInput;

/**
 * Markets a user can see:
 * - PUBLIC: everyone (once out of DRAFT, with a published startup).
 * - ORGANIZATION: members of the market's organization.
 * - RESTRICTED: the org's owners/admins, the study author, and invited study
 *   participants (who may be outside the org).
 */
export function visibleMarketsWhere(userId: string | null): Prisma.MarketWhereInput {
  if (!userId) return PUBLIC_MARKET_WHERE;
  return {
    status: { not: MarketStatus.DRAFT },
    OR: [
      { visibility: MarketVisibility.PUBLIC, startup: { isPublished: true } },
      {
        visibility: MarketVisibility.ORGANIZATION,
        organization: { memberships: { some: { userId } } },
      },
      {
        visibility: MarketVisibility.RESTRICTED,
        OR: [
          { organization: { memberships: { some: { userId, role: { in: [OrgRole.OWNER, OrgRole.ADMIN] } } } } },
          { study: { createdById: userId } },
          { study: { participants: { some: { userId } } } },
        ],
      },
    ],
  };
}

export async function canViewMarket(userId: string | null, marketId: string): Promise<boolean> {
  const match = await db.market.findFirst({
    where: { AND: [{ id: marketId }, visibleMarketsWhere(userId)] },
    select: { id: true },
  });
  return match !== null;
}

/** Throws NOT_FOUND unless the user can see the market. */
export async function requireMarketVisible(userId: string | null, marketId: string) {
  if (!(await canViewMarket(userId, marketId))) throw notFound("Market");
}

// ---------------------------------------------------------------------------
// Baseline model data
// ---------------------------------------------------------------------------

/**
 * Model data points a user may read: every scraped point, plus sponsor-provided
 * points from organizations the user belongs to. Sponsor data never resolves a
 * market, so resolution code should filter on provenance SCRAPED instead.
 */
export function visibleModelDataPointsWhere(userId: string | null): Prisma.ModelDataPointWhereInput {
  if (!userId) return { provenance: DataProvenance.SCRAPED };
  return {
    OR: [
      { provenance: DataProvenance.SCRAPED },
      { provenance: DataProvenance.SPONSOR_PROVIDED, organization: { memberships: { some: { userId } } } },
    ],
  };
}
