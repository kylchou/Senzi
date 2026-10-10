/**
 * INTEGRATION POINT(auth, organizations, startups, markets).
 *
 * This is the only file in lib/vc that depends on the Backend, Database & Security portions. The
 * expected exports are listed in lib/vc/README.md ("Integration contracts").
 */
import type { PrismaClient } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { createMarketForStudy } from "@/lib/admin/markets";
import type { PlatformGateway } from "../ports";
import { ORG_ROLES, type MarketStatus, type OrgRole } from "../types";

/** Unknown roles from the shared role model fail safe to read-only. */
function toOrgRole(role: string): OrgRole {
  const upper = role.toUpperCase();
  return (ORG_ROLES as readonly string[]).includes(upper) ? (upper as OrgRole) : "VIEWER";
}

export function createPlatformGateway(prisma: PrismaClient): PlatformGateway {
  return {
    async getSessionUser() {
      const user = await getCurrentUser();
      if (!user) return null;
      return {
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
        isPlatformAdmin: user.role === "ADMIN",
      };
    },

    async getMemberships(userId) {
      const rows = await prisma.organizationMember.findMany({
        where: { userId },
        include: { organization: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((m) => ({
        organizationId: m.organization.id,
        organizationName: m.organization.name,
        role: toOrgRole(m.role),
      }));
    },

    async getUsers(ids) {
      if (ids.length === 0) return [];
      return prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true },
      });
    },

    async findUsersByEmail(emails) {
      if (emails.length === 0) return [];
      return prisma.user.findMany({
        where: { email: { in: emails, mode: "insensitive" } },
        select: { id: true, name: true, email: true },
      });
    },

    async getStartups(ids) {
      if (ids.length === 0) return [];
      return prisma.startup.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, slug: true, industry: true },
      });
    },

    async searchStartups(query, limit) {
      return prisma.startup.findMany({
        where: { name: { contains: query, mode: "insensitive" } },
        select: { id: true, name: true, slug: true, industry: true },
        orderBy: { name: "asc" },
        take: limit,
      });
    },

    async listPublicMarketsForStartups(startupIds) {
      if (startupIds.length === 0) return [];
      const rows = await prisma.market.findMany({
        where: { startupId: { in: startupIds }, visibility: "PUBLIC" },
        select: { id: true, startupId: true, question: true, status: true, closesAt: true },
        orderBy: { closesAt: "asc" },
      });
      return rows.map((m) => ({ ...m, status: m.status as MarketStatus }));
    },

    async createMarketForStudy(input) {
      const market = await createMarketForStudy(input);
      return { marketId: market.id };
    },
  };
}
