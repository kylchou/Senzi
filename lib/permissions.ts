import type { Prisma } from "@/generated/prisma/client";
import {
  MarketStatus,
  MarketVisibility,
  OrgRole,
  StudyAccess,
  StudyRole,
} from "@/generated/prisma/enums";
import { forbidden, notFound } from "@/lib/api-response";
import { db } from "@/lib/db";
import { ORG_ROLE_RANK, type SessionUser } from "@/lib/types";

/**
 * Server-side authorization rules.
 *
 * Organization isolation: VC organization data (studies, org watchlists,
 * private markets, member lists) is visible only to members of that org.
 * Platform admins do NOT bypass this — they manage the public community
 * platform, not firms' private research.
 *
 * Non-members get NOT_FOUND rather than FORBIDDEN so private resources do not
 * reveal that they exist.
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
 * - ANALYST / VIEWER: nothing (they may still leave; see canLeave).
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
// Research studies
// ---------------------------------------------------------------------------

export type StudyAccessLevel = "read" | "edit" | "manage";

export interface StudyPermissions {
  canRead: boolean;
  canEdit: boolean;
  canManage: boolean;
}

/**
 * Pure study access rules.
 * - Must be a member of the study's organization; otherwise no access at all.
 * - Org OWNER/ADMIN: full access to every study in their org.
 * - ORGANIZATION studies: every org member can read.
 * - RESTRICTED studies: only explicit study members can read.
 * - Edit: study LEAD/CONTRIBUTOR. Manage (settings, members): study LEAD.
 * - Org VIEWERs are read-only regardless of study role.
 */
export function computeStudyPermissions(input: {
  orgRole: OrgRole | null;
  studyRole: StudyRole | null;
  access: StudyAccess;
}): StudyPermissions {
  const { orgRole, studyRole, access } = input;
  if (!orgRole) return { canRead: false, canEdit: false, canManage: false };
  if (hasOrgRole(orgRole, OrgRole.ADMIN)) return { canRead: true, canEdit: true, canManage: true };

  const canRead = access === StudyAccess.ORGANIZATION || studyRole !== null;
  const writable = orgRole !== OrgRole.VIEWER;
  return {
    canRead,
    canEdit: writable && (studyRole === StudyRole.LEAD || studyRole === StudyRole.CONTRIBUTOR),
    canManage: writable && studyRole === StudyRole.LEAD,
  };
}

export async function getStudyPermissions(userId: string, studyId: string) {
  const study = await db.researchStudy.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      organizationId: true,
      access: true,
      members: { where: { userId }, select: { role: true } },
    },
  });
  if (!study) return null;
  const orgRole = await getOrgRole(userId, study.organizationId);
  const permissions = computeStudyPermissions({
    orgRole,
    studyRole: study.members[0]?.role ?? null,
    access: study.access,
  });
  return { study: { id: study.id, organizationId: study.organizationId }, orgRole, permissions };
}

/** Throws NOT_FOUND when the study is invisible to the user, FORBIDDEN when read-only. */
export async function requireStudyAccess(
  user: Pick<SessionUser, "id">,
  studyId: string,
  level: StudyAccessLevel = "read",
) {
  const result = await getStudyPermissions(user.id, studyId);
  if (!result || !result.permissions.canRead) throw notFound("Study");
  if (level === "edit" && !result.permissions.canEdit) throw forbidden("You cannot edit this study");
  if (level === "manage" && !result.permissions.canManage) throw forbidden("You cannot manage this study");
  return result;
}

/** Prisma filter for the studies a user may read (use for listings). */
export function readableStudiesWhere(userId: string): Prisma.ResearchStudyWhereInput {
  return {
    organization: { memberships: { some: { userId } } },
    OR: [
      { access: StudyAccess.ORGANIZATION },
      { members: { some: { userId } } },
      {
        organization: {
          memberships: { some: { userId, role: { in: [OrgRole.OWNER, OrgRole.ADMIN] } } },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Markets & startups
// ---------------------------------------------------------------------------

/**
 * Use these in every public (unauthenticated/community) query so private,
 * draft, and unpublished records can never leak through a public API.
 */
export const PUBLIC_MARKET_WHERE = {
  visibility: MarketVisibility.PUBLIC,
  status: { not: MarketStatus.DRAFT },
  startup: { isPublished: true },
} satisfies Prisma.MarketWhereInput;

/** Unlisted markets are fetchable by slug but excluded from listings. */
export const DIRECT_LINK_MARKET_WHERE = {
  visibility: { in: [MarketVisibility.PUBLIC, MarketVisibility.UNLISTED] },
  status: { not: MarketStatus.DRAFT },
  startup: { isPublished: true },
} satisfies Prisma.MarketWhereInput;

export const PUBLIC_STARTUP_WHERE = { isPublished: true } satisfies Prisma.StartupWhereInput;

/** Markets a signed-in user can see: public/unlisted plus their orgs' private markets. */
export function visibleMarketsWhere(userId: string | null): Prisma.MarketWhereInput {
  if (!userId) return DIRECT_LINK_MARKET_WHERE;
  return {
    status: { not: MarketStatus.DRAFT },
    OR: [
      { visibility: { in: [MarketVisibility.PUBLIC, MarketVisibility.UNLISTED] }, startup: { isPublished: true } },
      {
        visibility: MarketVisibility.PRIVATE,
        organization: { memberships: { some: { userId } } },
      },
    ],
  };
}

export async function canViewMarket(userId: string | null, marketId: string): Promise<boolean> {
  const match = await db.market.findFirst({
    where: { id: marketId, ...visibleMarketsWhere(userId) },
    select: { id: true },
  });
  return match !== null;
}

/** Throws NOT_FOUND unless the user can see the market. */
export async function requireMarketVisible(userId: string | null, marketId: string) {
  if (!(await canViewMarket(userId, marketId))) throw notFound("Market");
}

// ---------------------------------------------------------------------------
// Watchlists
// ---------------------------------------------------------------------------

/**
 * Personal watchlists: owner only. Org watchlists: any member reads,
 * ANALYST+ (or the owner, while still a member) writes.
 */
export async function requireWatchlistAccess(
  user: Pick<SessionUser, "id">,
  watchlistId: string,
  level: "read" | "write" = "read",
) {
  const watchlist = await db.watchlist.findUnique({
    where: { id: watchlistId },
    select: { id: true, ownerId: true, organizationId: true },
  });
  if (!watchlist) throw notFound("Watchlist");

  if (!watchlist.organizationId) {
    if (watchlist.ownerId !== user.id) throw notFound("Watchlist");
    return watchlist;
  }

  const role = await getOrgRole(user.id, watchlist.organizationId);
  if (!role) throw notFound("Watchlist");
  if (level === "write" && watchlist.ownerId !== user.id && !hasOrgRole(role, OrgRole.ANALYST)) {
    throw forbidden("You cannot edit this watchlist");
  }
  return watchlist;
}
