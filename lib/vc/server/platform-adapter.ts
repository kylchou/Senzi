/**
 * INTEGRATION POINT (auth, organizations, startups, markets).
 *
 * This is the only file in lib/vc that depends on the Backend, Database & Security portions.
 * Names follow docs/API.md ("Darsh: VC intelligence").
 */
import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { closeMarketForStudy, createMarketForStudy } from "@/lib/admin";
import { getCurrentUser, isPlatformAdmin } from "@/lib/auth";
import { PUBLIC_MARKET_WHERE } from "@/lib/permissions";
import type { PlatformGateway } from "../ports";

const userSelect = { id: true, displayName: true, email: true } as const;
const toUserSummary = (u: { id: string; displayName: string; email: string }) => ({
  id: u.id,
  name: u.displayName,
  email: u.email,
});

export function createPlatformGateway(db: PrismaClient): PlatformGateway {
  return {
    async getSessionUser() {
      const user = await getCurrentUser();
      if (!user) return null;
      return {
        id: user.id,
        name: user.displayName,
        email: user.email,
        isPlatformAdmin: isPlatformAdmin(user),
      };
    },

    async getMemberships(userId) {
      const rows = await db.organizationMembership.findMany({
        where: { userId },
        include: { organization: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((m) => ({
        organizationId: m.organization.id,
        organizationName: m.organization.name,
        role: m.role,
      }));
    },

    async getUsers(ids) {
      if (ids.length === 0) return [];
      const rows = await db.user.findMany({ where: { id: { in: ids } }, select: userSelect });
      return rows.map(toUserSummary);
    },

    async findUsersByEmail(emails) {
      if (emails.length === 0) return [];
      const rows = await db.user.findMany({
        where: { email: { in: emails, mode: "insensitive" } },
        select: userSelect,
      });
      return rows.map(toUserSummary);
    },

    async getStartups(ids) {
      if (ids.length === 0) return [];
      return db.startup.findMany({
        where: { id: { in: ids }, isPublished: true },
        select: { id: true, name: true, slug: true, industry: true },
      });
    },

    /** Published startups only, so unpublished ones can't be picked for new studies. */
    async searchStartups(query, limit) {
      return db.startup.findMany({
        where: { isPublished: true, name: { contains: query, mode: "insensitive" } },
        select: { id: true, name: true, slug: true, industry: true },
        orderBy: { name: "asc" },
        take: limit,
      });
    },

    async listPublicMarketsForStartups(startupIds) {
      if (startupIds.length === 0) return [];
      return db.market.findMany({
        where: { ...PUBLIC_MARKET_WHERE, startupId: { in: startupIds }, study: { is: null } },
        select: { id: true, slug: true, startupId: true, question: true, status: true, closesAt: true },
        orderBy: { closesAt: "asc" },
      });
    },

    async createMarketForStudy(input) {
      const market = await createMarketForStudy(input);
      return { marketId: market.id };
    },

    async listOrgMembers(organizationId) {
      return db.organizationMembership.findMany({ where: { organizationId }, select: { userId: true, role: true } });
    },

    async notifyUsers(notifications) {
      if (notifications.length === 0) return 0;
      const { count } = await db.notification.createMany({ data: notifications });
      return count;
    },

    async markAlertNotificationsRead(userId, alertIds, at) {
      if (alertIds.length === 0) return;
      await db.notification.updateMany({
        where: {
          userId,
          readAt: null,
          OR: alertIds.map((id) => ({ data: { path: ["vcAlertId"], equals: id } })),
        },
        data: { readAt: at },
      });
    },

    async closeMarketForStudy(input) {
      await closeMarketForStudy(input);
    },
  };
}
