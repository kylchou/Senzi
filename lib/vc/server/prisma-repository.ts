/**
 * Prisma implementation of VcRepository. Model names follow
 * prisma/schema.prisma.
 */
import "server-only";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { NewStudy, NewStudyEvent, StudyFilter, StudyPatch, VcRepository } from "../ports";
import type {
  AlertType,
  SavedReport,
  Study,
  StudyReport,
  VcAlert,
  Watchlist,
  WatchlistItem,
} from "../types";

const studyInclude = {
  sources: { orderBy: { position: "asc" } },
  participants: { select: { userId: true } },
} satisfies Prisma.ResearchStudyInclude;

type StudyRow = Prisma.ResearchStudyGetPayload<{ include: typeof studyInclude }>;

function toStudy(row: StudyRow): Study {
  const { sources, participants, ...rest } = row;
  return {
    ...rest,
    sources: sources.map((s) => ({
      id: s.id,
      url: s.url,
      title: s.title,
      publisher: s.publisher,
      publishedAt: s.publishedAt,
    })),
    participantIds: participants.map((p) => p.userId),
  };
}

const watchlistInclude = { items: { orderBy: { createdAt: "asc" } } } satisfies Prisma.WatchlistInclude;

function toWatchlist(row: Prisma.WatchlistGetPayload<{ include: typeof watchlistInclude }>): Watchlist {
  return { ...row, items: row.items as WatchlistItem[] };
}

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

function studyWhere(filter: StudyFilter): Prisma.ResearchStudyWhereInput {
  return {
    ...(filter.organizationId && { organizationId: filter.organizationId }),
    ...(filter.visibility && { visibility: filter.visibility }),
    ...(filter.statuses && { status: { in: [...filter.statuses] } }),
    ...(filter.ids && { id: { in: filter.ids } }),
    ...(filter.startupIds && { startupId: { in: filter.startupIds } }),
    ...(filter.hasMarket && { marketId: { not: null } }),
    ...(filter.participantUserId && { participants: { some: { userId: filter.participantUserId } } }),
  };
}

const sourceRows = (studyId: string, sources: NonNullable<StudyPatch["sources"]>) =>
  sources.map((s, position) => ({ ...s, studyId, position }));

export function createPrismaVcRepository(prisma: PrismaClient): VcRepository {
  return {
    async findStudy(id) {
      const row = await prisma.researchStudy.findUnique({ where: { id }, include: studyInclude });
      return row && toStudy(row);
    },

    async findStudyByMarketId(marketId) {
      const row = await prisma.researchStudy.findUnique({ where: { marketId }, include: studyInclude });
      return row && toStudy(row);
    },

    async listStudies(filter) {
      const rows = await prisma.researchStudy.findMany({
        where: studyWhere(filter),
        include: studyInclude,
        orderBy: { updatedAt: "desc" },
        take: filter.limit,
      });
      return rows.map(toStudy);
    },

    async createStudy(data: NewStudy) {
      const { sources, ...fields } = data;
      const row = await prisma.researchStudy.create({
        data: {
          ...fields,
          sources: { create: sources.map((s, position) => ({ ...s, position })) },
          events: {
            create: { actorId: data.createdById, action: "create", fromStatus: null, toStatus: "DRAFT" },
          },
        },
        include: studyInclude,
      });
      return toStudy(row);
    },

    async updateStudy(id, expectedVersion, patch, event?: NewStudyEvent) {
      return prisma.$transaction(async (tx) => {
        const { sources, ...fields } = patch;
        const result = await tx.researchStudy.updateMany({
          where: { id, version: expectedVersion },
          data: { ...fields, version: { increment: 1 } },
        });
        if (result.count === 0) return null;
        if (sources) {
          await tx.studySource.deleteMany({ where: { studyId: id } });
          if (sources.length) await tx.studySource.createMany({ data: sourceRows(id, sources) });
        }
        if (event) await tx.studyEvent.create({ data: { ...event, studyId: id } });
        return toStudy(await tx.researchStudy.findUniqueOrThrow({ where: { id }, include: studyInclude }));
      });
    },

    async replaceParticipants(studyId, userIds, addedById) {
      await prisma.$transaction([
        prisma.studyParticipant.deleteMany({ where: { studyId, userId: { notIn: userIds } } }),
        prisma.studyParticipant.createMany({
          data: userIds.map((userId) => ({ studyId, userId, addedById })),
          skipDuplicates: true,
        }),
      ]);
    },

    async listEvents(studyId) {
      return prisma.studyEvent.findMany({ where: { studyId }, orderBy: { createdAt: "asc" } });
    },

    async listNotes(studyId) {
      return prisma.studyNote.findMany({ where: { studyId }, orderBy: { createdAt: "desc" } });
    },
    async findNote(id) {
      return prisma.studyNote.findUnique({ where: { id } });
    },
    async createNote(data) {
      return prisma.studyNote.create({ data });
    },
    async deleteNote(id) {
      await prisma.studyNote.delete({ where: { id } });
    },

    async listWatchlists(organizationId) {
      const rows = await prisma.watchlist.findMany({
        where: { organizationId },
        include: watchlistInclude,
        orderBy: { createdAt: "asc" },
      });
      return rows.map(toWatchlist);
    },
    async listAllWatchlists() {
      const rows = await prisma.watchlist.findMany({ include: watchlistInclude });
      return rows.map(toWatchlist);
    },
    async findWatchlist(id) {
      const row = await prisma.watchlist.findUnique({ where: { id }, include: watchlistInclude });
      return row && toWatchlist(row);
    },
    async createWatchlist(data) {
      try {
        return toWatchlist(await prisma.watchlist.create({ data, include: watchlistInclude }));
      } catch (err) {
        if (isUniqueViolation(err)) return null;
        throw err;
      }
    },
    async deleteWatchlist(id) {
      await prisma.watchlist.delete({ where: { id } });
    },
    async addWatchlistItem(data) {
      const where = {
        watchlistId: data.watchlistId,
        ...(data.type === "STUDY" ? { studyId: data.studyId } : { startupId: data.startupId }),
      };
      const existing = await prisma.watchlistItem.findFirst({ where });
      if (existing) return existing as WatchlistItem;
      try {
        return (await prisma.watchlistItem.create({ data })) as WatchlistItem;
      } catch (err) {
        // Lost a race with a concurrent add of the same item.
        if (isUniqueViolation(err)) return (await prisma.watchlistItem.findFirstOrThrow({ where })) as WatchlistItem;
        throw err;
      }
    },
    async removeWatchlistItem(watchlistId, itemId) {
      const { count } = await prisma.watchlistItem.deleteMany({ where: { id: itemId, watchlistId } });
      return count > 0;
    },

    async createAlerts(alerts) {
      if (alerts.length === 0) return [];
      const rows = await prisma.vcAlert.createManyAndReturn({
        data: alerts.map((a) => ({
          organizationId: a.organizationId,
          type: a.type,
          studyId: a.studyId ?? null,
          startupId: a.startupId ?? null,
          marketId: a.marketId ?? null,
          title: a.title,
          body: a.body,
          payload: (a.payload ?? {}) as Prisma.InputJsonValue,
          dedupeKey: a.dedupeKey,
        })),
        skipDuplicates: true,
      });
      return rows.map((a) => ({
        ...a,
        type: a.type as AlertType,
        payload: (a.payload ?? {}) as Record<string, unknown>,
      }));
    },
    async listAlerts(organizationId, userId, options) {
      const rows = await prisma.vcAlert.findMany({
        where: {
          organizationId,
          ...(options.type && { type: options.type }),
          ...(options.unreadOnly && { receipts: { none: { userId } } }),
        },
        include: { receipts: { where: { userId }, select: { readAt: true } } },
        orderBy: { createdAt: "desc" },
        take: options.limit,
      });
      return rows.map(
        ({ receipts, ...a }): VcAlert => ({
          ...a,
          type: a.type as AlertType,
          payload: (a.payload ?? {}) as Record<string, unknown>,
          readAt: receipts[0]?.readAt ?? null,
        }),
      );
    },
    async countUnreadAlertsByStudy(organizationId, userId) {
      const rows = await prisma.vcAlert.groupBy({
        by: ["studyId"],
        where: { organizationId, receipts: { none: { userId } } },
        _count: { _all: true },
      });
      return rows.map((r) => ({ studyId: r.studyId, count: r._count._all }));
    },
    async markAlertsRead(organizationId, userId, alertIds, at) {
      const owned = await prisma.vcAlert.findMany({
        where: { id: { in: alertIds }, organizationId },
        select: { id: true },
      });
      if (owned.length === 0) return;
      await prisma.vcAlertReceipt.createMany({
        data: owned.map((a) => ({ alertId: a.id, userId, readAt: at })),
        skipDuplicates: true,
      });
    },

    async createReport(data) {
      const row = await prisma.vcReport.create({
        data: { ...data, content: data.content as unknown as Prisma.InputJsonValue },
      });
      return { ...row, content: row.content as unknown as StudyReport } satisfies SavedReport;
    },
    async listReports(organizationId, options) {
      const rows = await prisma.vcReport.findMany({
        where: { organizationId, ...(options.studyId && { studyId: options.studyId }) },
        orderBy: { createdAt: "desc" },
        take: options.limit,
      });
      return rows.map((row) => ({ ...row, content: row.content as unknown as StudyReport }));
    },
    async findReport(id) {
      const row = await prisma.vcReport.findUnique({ where: { id } });
      return row && { ...row, content: row.content as unknown as StudyReport };
    },
  };
}
