import { AccountType, NotificationType, OrgRole } from "@/generated/prisma/enums";
import { conflict, forbidden, invalidState, notFound } from "@/lib/api-response";
import { recordAudit } from "@/lib/audit";
import { db, isUniqueViolation, type TxClient } from "@/lib/db";
import { canManageMember, requireOrgRole } from "@/lib/permissions";
import {
  PENDING_AUTH_PREFIX,
  type MembershipSummary,
  type OrganizationMemberDTO,
  type RequestContext,
  type SessionUser,
} from "@/lib/types";
import type {
  AddMemberInput,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from "@/lib/validation";

/** Organization and membership management. Authorization is checked here. */

export async function listMyOrganizations(user: SessionUser): Promise<MembershipSummary[]> {
  const memberships = await db.organizationMembership.findMany({
    where: { userId: user.id },
    orderBy: { organization: { name: "asc" } },
    select: { role: true, organization: { select: { id: true, name: true, slug: true } } },
  });
  return memberships.map((m) => ({
    organizationId: m.organization.id,
    organizationName: m.organization.name,
    organizationSlug: m.organization.slug,
    role: m.role,
  }));
}

export async function createOrganization(user: SessionUser, input: CreateOrganizationInput, ctx: RequestContext = {}) {
  try {
    return await db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          ...input,
          memberships: { create: { userId: user.id, role: OrgRole.OWNER } },
        },
      });
      await recordAudit(
        { actorId: user.id, organizationId: org.id, action: "organization.create", entityType: "Organization", entityId: org.id, ipAddress: ctx.ip },
        tx,
      );
      return org;
    });
  } catch (error) {
    if (isUniqueViolation(error, "slug")) throw conflict("That organization URL is taken");
    throw error;
  }
}

export async function getOrganization(user: SessionUser, organizationId: string) {
  const role = await requireOrgRole(user, organizationId, OrgRole.VIEWER);
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: { _count: { select: { memberships: true, studies: true } } },
  });
  const { _count, ...rest } = org;
  return { ...rest, memberCount: _count.memberships, studyCount: _count.studies, myRole: role };
}

export async function updateOrganization(
  user: SessionUser,
  organizationId: string,
  input: UpdateOrganizationInput,
  ctx: RequestContext = {},
) {
  await requireOrgRole(user, organizationId, OrgRole.ADMIN);
  try {
    return await db.$transaction(async (tx) => {
      const org = await tx.organization.update({ where: { id: organizationId }, data: input });
      await recordAudit(
        { actorId: user.id, organizationId, action: "organization.update", entityType: "Organization", entityId: organizationId, data: { changed: Object.keys(input) }, ipAddress: ctx.ip },
        tx,
      );
      return org;
    });
  } catch (error) {
    if (isUniqueViolation(error, "slug")) throw conflict("That organization URL is taken");
    throw error;
  }
}

export async function deleteOrganization(user: SessionUser, organizationId: string, ctx: RequestContext = {}) {
  await requireOrgRole(user, organizationId, OrgRole.OWNER);
  const privateMarkets = await db.market.count({ where: { organizationId } });
  if (privateMarkets > 0) {
    throw invalidState("This organization still owns private markets; ask an admin to archive them first");
  }
  await db.$transaction(async (tx) => {
    await tx.organization.delete({ where: { id: organizationId } });
    await recordAudit(
      { actorId: user.id, organizationId, action: "organization.delete", entityType: "Organization", entityId: organizationId, ipAddress: ctx.ip },
      tx,
    );
  });
}

export async function listMembers(user: SessionUser, organizationId: string): Promise<OrganizationMemberDTO[]> {
  await requireOrgRole(user, organizationId, OrgRole.VIEWER);
  const rows = await db.organizationMembership.findMany({
    where: { organizationId },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, displayName: true, username: true, email: true, avatarUrl: true, authId: true } },
    },
  });
  return rows.map(({ role, createdAt, user: member }) => ({
    userId: member.id,
    displayName: member.displayName,
    username: member.username,
    email: member.email,
    avatarUrl: member.avatarUrl,
    role,
    pending: member.authId.startsWith(PENDING_AUTH_PREFIX),
    joinedAt: createdAt.toISOString(),
  }));
}

/**
 * Adds a member by email. If nobody with that email has signed up yet, a
 * pending placeholder user is created; it is claimed automatically the first
 * time someone signs in with that verified email (see lib/auth.ts).
 */
export async function addMember(
  user: SessionUser,
  organizationId: string,
  input: AddMemberInput,
  ctx: RequestContext = {},
) {
  const actorRole = await requireOrgRole(user, organizationId, OrgRole.ADMIN);
  if (!canManageMember(actorRole, { kind: "add", newRole: input.role })) {
    throw forbidden(`Admins can only add analysts and viewers`);
  }

  try {
    return await db.$transaction(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
      const existing = await tx.user.findUnique({ where: { email: input.email }, select: { id: true, accountType: true } });
      // A trader in a VC org could trade on the org's own questions.
      if (existing?.accountType === AccountType.TRADER) {
        throw invalidState("That person has a trader account. A Senzi admin has to switch it to VC before they can join.");
      }
      if (existing && !existing.accountType) {
        await tx.user.update({ where: { id: existing.id }, data: { accountType: AccountType.VC } });
      }
      const target =
        existing ??
        (await tx.user.create({
          data: {
            authId: `${PENDING_AUTH_PREFIX}${input.email}`,
            email: input.email,
            displayName: input.email.split("@")[0]!,
            accountType: AccountType.VC,
          },
          select: { id: true, accountType: true },
        }));

      const membership = await tx.organizationMembership.create({
        data: { organizationId, userId: target.id, role: input.role, invitedById: user.id },
      });
      await tx.notification.create({
        data: {
          userId: target.id,
          type: NotificationType.ORG_INVITE,
          title: `You were added to ${org.name}`,
          data: { organizationId },
        },
      });
      await recordAudit(
        { actorId: user.id, organizationId, action: "organization.member.add", entityType: "OrganizationMembership", entityId: membership.id, data: { userId: target.id, role: input.role }, ipAddress: ctx.ip },
        tx,
      );
      return membership;
    });
  } catch (error) {
    if (isUniqueViolation(error, "organizationId")) throw conflict("That person is already a member");
    throw error;
  }
}

async function assertNotLastOwner(tx: TxClient, organizationId: string, targetRole: OrgRole) {
  if (targetRole !== OrgRole.OWNER) return;
  const owners = await tx.organizationMembership.count({ where: { organizationId, role: OrgRole.OWNER } });
  if (owners <= 1) throw invalidState("An organization must keep at least one owner");
}

export async function changeMemberRole(
  user: SessionUser,
  organizationId: string,
  targetUserId: string,
  newRole: OrgRole,
  ctx: RequestContext = {},
) {
  const actorRole = await requireOrgRole(user, organizationId, OrgRole.ADMIN);
  return db.$transaction(async (tx) => {
    // Lock the org's owner rows so two owners cannot demote each other at once.
    await tx.$queryRaw`SELECT id FROM "OrganizationMembership" WHERE "organizationId" = ${organizationId} AND "role" = 'OWNER' FOR UPDATE`;
    const target = await tx.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    if (!target) throw notFound("Member");
    if (!canManageMember(actorRole, { kind: "changeRole", targetRole: target.role, newRole })) {
      throw forbidden("You cannot change this member's role");
    }
    if (newRole !== OrgRole.OWNER) await assertNotLastOwner(tx, organizationId, target.role);

    const updated = await tx.organizationMembership.update({ where: { id: target.id }, data: { role: newRole } });
    await recordAudit(
      { actorId: user.id, organizationId, action: "organization.member.role", entityType: "OrganizationMembership", entityId: target.id, data: { userId: targetUserId, from: target.role, to: newRole }, ipAddress: ctx.ip },
      tx,
    );
    return updated;
  });
}

/** Removes a member. Anyone may remove themselves (leave) unless they are the last owner. */
export async function removeMember(
  user: SessionUser,
  organizationId: string,
  targetUserId: string,
  ctx: RequestContext = {},
) {
  const leaving = targetUserId === user.id;
  const actorRole = await requireOrgRole(user, organizationId, leaving ? OrgRole.VIEWER : OrgRole.ADMIN);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OrganizationMembership" WHERE "organizationId" = ${organizationId} AND "role" = 'OWNER' FOR UPDATE`;
    const target = await tx.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId: targetUserId } },
    });
    if (!target) throw notFound("Member");
    if (!leaving && !canManageMember(actorRole, { kind: "remove", targetRole: target.role })) {
      throw forbidden("You cannot remove this member");
    }
    await assertNotLastOwner(tx, organizationId, target.role);

    // Study invitations inside this org go with the org membership.
    await tx.studyParticipant.deleteMany({ where: { userId: targetUserId, study: { organizationId } } });
    await tx.organizationMembership.delete({ where: { id: target.id } });
    await recordAudit(
      { actorId: user.id, organizationId, action: leaving ? "organization.member.leave" : "organization.member.remove", entityType: "OrganizationMembership", entityId: target.id, data: { userId: targetUserId, role: target.role }, ipAddress: ctx.ip },
      tx,
    );
  });
}
