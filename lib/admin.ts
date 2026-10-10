import { z } from "zod";
import type { Market, Prisma } from "@/generated/prisma/client";
import {
  MarketStatus,
  NotificationType,
  PlatformRole,
  SettlementStatus,
  SnapshotTrigger,
  StudyStatus,
  StudyVisibility,
} from "@/generated/prisma/enums";
import { assertAdmin } from "@/lib/admin-guard";
import { conflict, invalidState, notFound } from "@/lib/api-response";
import { diffChanges, recordAudit } from "@/lib/audit";
import { applyCreditTransaction, type AppliedCreditTransaction } from "@/lib/credits";
import { db, isUniqueViolation, type TxClient } from "@/lib/db";
import type { AdminMarketSummary, AdminStartupSummary, RequestContext, SessionUser } from "@/lib/types";
import {
  checkMarketInvariants,
  createMarketForStudySchema,
  idSchema,
  type AdminCreditAdjustmentInput,
  type CreateMarketForStudyInput,
  type CreateMarketInput,
  type CreateStartupInput,
  type MarketSourceInput,
  type MarketStatusChangeInput,
  type UpdateMarketInput,
  type UpdateStartupInput,
} from "@/lib/validation";

/**
 * Admin services: startups, markets, resolutions, credit adjustments, roles.
 *
 * Every function takes the acting user and re-checks the platform ADMIN role,
 * so callers (API routes, server actions) cannot forget it. Every change is
 * audit-logged in the same transaction.
 *
 * Settlement (paying out credits after a resolution) belongs to the
 * forecasting engine; this module only records the resolution and exposes the
 * settlement status helpers at the bottom.
 */

export { assertAdmin };

// ---------------------------------------------------------------------------
// Startups
// ---------------------------------------------------------------------------

export async function createStartup(actor: SessionUser, input: CreateStartupInput, ctx: RequestContext = {}) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const startup = await tx.startup.create({ data: { ...input, createdById: actor.id } });
    await recordAudit(
      { actorId: actor.id, action: "startup.create", entityType: "Startup", entityId: startup.id, data: { slug: startup.slug }, ipAddress: ctx.ip },
      tx,
    );
    return startup;
  });
}

export async function updateStartup(
  actor: SessionUser,
  startupId: string,
  input: UpdateStartupInput,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const existing = await tx.startup.findUnique({ where: { id: startupId } });
    if (!existing) throw notFound("Startup");
    const startup = await tx.startup.update({ where: { id: startupId }, data: input });
    await recordAudit(
      {
        actorId: actor.id,
        action: "startup.update",
        entityType: "Startup",
        entityId: startupId,
        data: { changes: diffChanges(existing, input) } as Prisma.InputJsonValue,
        ipAddress: ctx.ip,
      },
      tx,
    );
    return startup;
  });
}

export async function listAdminStartups(actor: SessionUser, opts: { q?: string } = {}): Promise<AdminStartupSummary[]> {
  assertAdmin(actor);
  const rows = await db.startup.findMany({
    where: opts.q ? { name: { contains: opts.q, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      industry: true,
      stage: true,
      isPublished: true,
      _count: { select: { markets: true } },
    },
  });
  return rows.map(({ _count, ...row }) => ({ ...row, marketCount: _count.markets }));
}

export async function getAdminStartup(actor: SessionUser, startupId: string) {
  assertAdmin(actor);
  const startup = await db.startup.findUnique({ where: { id: startupId } });
  if (!startup) throw notFound("Startup");
  return startup;
}

// ---------------------------------------------------------------------------
// Markets
// ---------------------------------------------------------------------------

/**
 * Status changes an admin can make directly. RESOLVED (and CANCELLED once
 * forecasts exist) only happen through resolveMarket(), which records evidence.
 */
export const MARKET_STATUS_TRANSITIONS: Record<MarketStatus, readonly MarketStatus[]> = {
  DRAFT: [MarketStatus.OPEN, MarketStatus.CANCELLED],
  OPEN: [MarketStatus.CLOSED, MarketStatus.CANCELLED],
  CLOSED: [MarketStatus.OPEN, MarketStatus.CANCELLED],
  RESOLVED: [],
  CANCELLED: [],
};

export function canTransitionMarket(from: MarketStatus, to: MarketStatus): boolean {
  return MARKET_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Once a market opens, its terms (question, criteria, baseline, sources,
 * visibility, limits...) are frozen. Only these can still change, and every
 * change is audit-logged with before/after values.
 */
export const EDITABLE_AFTER_OPEN = ["description", "category", "closesAt", "resolvesBy"] as const;

function sameValue(a: unknown, b: unknown) {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

export function termsAreEditable(market: Pick<Market, "status">): boolean {
  return market.status === MarketStatus.DRAFT;
}

async function assertMarketReferences(
  tx: TxClient,
  refs: { startupId?: string; organizationId?: string | null },
) {
  if (refs.startupId) {
    const startup = await tx.startup.findUnique({ where: { id: refs.startupId }, select: { id: true } });
    if (!startup) throw notFound("Startup");
  }
  if (refs.organizationId) {
    const org = await tx.organization.findUnique({ where: { id: refs.organizationId }, select: { id: true } });
    if (!org) throw notFound("Organization");
  }
}

/** Records the opening baseline as the first point of the market's history. */
async function createOpeningSnapshot(tx: TxClient, market: Market) {
  const last = await tx.marketSnapshot.aggregate({ where: { marketId: market.id }, _max: { sequence: true } });
  await tx.marketSnapshot.create({
    data: {
      marketId: market.id,
      sequence: (last._max.sequence ?? 0) + 1,
      trigger: SnapshotTrigger.OPENING,
      openingBaseline: market.openingBaseline,
      modelValue: market.modelValue,
      yesCredits: market.yesCredits,
      noCredits: market.noCredits,
      allocationShare: null,
      forecastCount: market.forecastCount,
      forecasterCount: 0,
    },
  });
}

function sourceRows(sources: MarketSourceInput[]) {
  return sources.map((source, position) => ({ ...source, position }));
}

export async function createMarket(actor: SessionUser, input: CreateMarketInput, ctx: RequestContext = {}) {
  assertAdmin(actor);
  const { openImmediately, sources, ...fields } = input;
  const now = new Date();
  if (openImmediately && fields.closesAt <= now) {
    throw invalidState("Cannot open a market whose deadline has passed");
  }

  return db.$transaction(async (tx) => {
    await assertMarketReferences(tx, fields);
    const market = await tx.market.create({
      data: {
        ...fields,
        organizationId: fields.organizationId ?? null,
        baselineSetAt: fields.openingBaseline != null ? now : null,
        status: openImmediately ? MarketStatus.OPEN : MarketStatus.DRAFT,
        opensAt: openImmediately && fields.opensAt > now ? now : fields.opensAt,
        createdById: actor.id,
        sources: { create: sourceRows(sources) },
      },
    });
    if (market.status === MarketStatus.OPEN) await createOpeningSnapshot(tx, market);
    await recordAudit(
      {
        actorId: actor.id,
        organizationId: market.organizationId,
        action: "market.create",
        entityType: "Market",
        entityId: market.id,
        data: { slug: market.slug, status: market.status, openingBaseline: market.openingBaseline },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return market;
  });
}

export async function updateMarket(
  actor: SessionUser,
  marketId: string,
  input: UpdateMarketInput,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const market = await tx.market.findUnique({ where: { id: marketId } });
    if (!market) throw notFound("Market");
    if (market.status === MarketStatus.RESOLVED || market.status === MarketStatus.CANCELLED) {
      throw invalidState("Resolved and cancelled markets cannot be edited");
    }

    // Resubmitting an unchanged value is fine; only real changes count.
    const { sources: sourceInput, ...fieldInput } = input;
    const changed = (Object.keys(fieldInput) as (keyof typeof fieldInput)[]).filter(
      (field) => fieldInput[field] !== undefined && !sameValue(fieldInput[field], market[field as keyof Market]),
    );
    const currentSources = await tx.marketSource.findMany({ where: { marketId }, orderBy: { position: "asc" } });
    const sourcesChanged =
      sourceInput !== undefined &&
      JSON.stringify(sourceInput.map((x) => [x.title, x.url])) !== JSON.stringify(currentSources.map((x) => [x.title, x.url]));

    if (!termsAreEditable(market)) {
      const locked = changed.filter((f) => !(EDITABLE_AFTER_OPEN as readonly string[]).includes(f));
      if (sourcesChanged) locked.push("sources" as never);
      if (locked.length > 0) {
        throw invalidState(`Cannot change ${locked.join(", ")} after the market has opened`);
      }
    }
    const linkedStudy = await tx.researchStudy.findUnique({ where: { marketId }, select: { id: true } });
    if (linkedStudy && changed.some((f) => f === "visibility" || f === "organizationId")) {
      throw invalidState("This market belongs to a research study; change visibility through the study");
    }

    // Re-check cross-field rules against the merged record.
    const merged = { ...market, ...input };
    z.any().superRefine(checkMarketInvariants).parse(merged);
    if (input.closesAt && market.status === MarketStatus.OPEN && input.closesAt <= new Date()) {
      throw invalidState("An open market's deadline must be in the future; close it instead");
    }
    await assertMarketReferences(tx, input);

    const updated = await tx.market.update({
      where: { id: marketId },
      data: {
        ...fieldInput,
        ...(changed.includes("openingBaseline") ? { baselineSetAt: new Date() } : {}),
        ...(sourcesChanged && sourceInput ? { sources: { deleteMany: {}, create: sourceRows(sourceInput) } } : {}),
      },
    });
    await recordAudit(
      {
        actorId: actor.id,
        organizationId: updated.organizationId,
        action: "market.update",
        entityType: "Market",
        entityId: marketId,
        data: {
          changes: diffChanges(market, fieldInput),
          ...(sourcesChanged ? { sources: { from: currentSources.map((x) => x.url), to: sourceInput!.map((x) => x.url) } } : {}),
        } as Prisma.InputJsonValue,
        ipAddress: ctx.ip,
      },
      tx,
    );
    return updated;
  });
}

export async function changeMarketStatus(
  actor: SessionUser,
  marketId: string,
  input: MarketStatusChangeInput,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const market = await tx.market.findUnique({ where: { id: marketId } });
    if (!market) throw notFound("Market");
    const to = input.status;
    if (!canTransitionMarket(market.status, to)) {
      throw invalidState(`Cannot move a ${market.status} market to ${to}`);
    }
    if (to === MarketStatus.CANCELLED && market.forecastCount > 0) {
      throw invalidState("This market has forecasts; propose a VOID resolution so stakes are refunded");
    }

    const now = new Date();
    const data: Prisma.MarketUpdateManyMutationInput = { status: to };
    if (to === MarketStatus.OPEN) {
      if (market.closesAt <= now) throw invalidState("Extend the deadline before opening this market");
      if (market.opensAt > now) data.opensAt = now;
    }

    // Compare-and-set on the old status so concurrent admin actions cannot interleave.
    const { count } = await tx.market.updateMany({ where: { id: marketId, status: market.status }, data });
    if (count === 0) throw conflict("Market status changed concurrently; reload and try again");
    const updated = await tx.market.findUniqueOrThrow({ where: { id: marketId } });

    if (market.status === MarketStatus.DRAFT && to === MarketStatus.OPEN) {
      await createOpeningSnapshot(tx, updated);
    }
    await recordAudit(
      {
        actorId: actor.id,
        organizationId: updated.organizationId,
        action: "market.status",
        entityType: "Market",
        entityId: marketId,
        data: { from: market.status, to, reason: input.reason ?? null },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return updated;
  });
}

/**
 * Opens the market for a reviewed VC research study. Called by VC Intelligence
 * after a platform admin approves and opens the study; that caller checks
 * authorization. Idempotent on studyId: the market's slug is derived from it,
 * so repeated or concurrent calls return the same market. Does not write to
 * the study itself; VC Intelligence stores the returned market id.
 */
export async function createMarketForStudy(raw: CreateMarketForStudyInput): Promise<Market> {
  const input = createMarketForStudySchema.parse(raw);
  const slug = `study-${input.studyId}`;

  const existing = await db.market.findUnique({ where: { slug } });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      const study = await tx.researchStudy.findUnique({
        where: { id: input.studyId },
        select: { organizationId: true, startupId: true, status: true },
      });
      if (!study) throw notFound("Study");
      if (study.organizationId !== input.organizationId || study.startupId !== input.startupId) {
        throw invalidState("Market details don't match the study");
      }
      if (study.status !== StudyStatus.APPROVED && study.status !== StudyStatus.OPEN) {
        throw invalidState("Only approved studies can open a market");
      }
      const now = new Date();
      if (input.closesAt <= now) throw invalidState("The study deadline has already passed");

      const isPublic = input.visibility === StudyVisibility.PUBLIC;
      const market = await tx.market.create({
        data: {
          slug,
          startupId: input.startupId,
          question: input.question,
          yesCriteria: input.yesCriteria,
          noCriteria: input.noCriteria,
          openingBaseline: input.openingBaseline.value,
          modelValue: input.openingBaseline.value,
          modelUpdatedAt: now,
          baselineMethodology: input.openingBaseline.methodology,
          baselineSetAt: now,
          visibility: input.visibility,
          organizationId: isPublic ? null : input.organizationId,
          status: MarketStatus.OPEN,
          opensAt: now,
          closesAt: input.closesAt,
          createdById: input.createdById,
          sources: { create: input.sources.map((s, position) => ({ ...s, position })) },
        },
      });
      await createOpeningSnapshot(tx, market);
      await recordAudit(
        {
          actorId: null,
          organizationId: input.organizationId,
          action: "market.createFromStudy",
          entityType: "Market",
          entityId: market.id,
          data: { studyId: input.studyId, visibility: input.visibility, requestedBy: input.createdById },
        },
        tx,
      );
      return market;
    });
  } catch (error) {
    // A concurrent call for the same study won the race.
    if (isUniqueViolation(error, "slug")) return db.market.findUniqueOrThrow({ where: { slug } });
    throw error;
  }
}

/**
 * Stops forecasting on a study's market when VC Intelligence closes the study
 * early. The caller (the study close transition) checks authorization.
 * Idempotent: a market that is already CLOSED, RESOLVED, or CANCELLED is
 * returned unchanged. Returns null when the study never opened a market.
 */
export async function closeMarketForStudy(input: {
  studyId: string;
  closedById: string | null;
  reason?: string | null;
}): Promise<Market | null> {
  const studyId = idSchema.parse(input.studyId);
  return db.$transaction(async (tx) => {
    const study = await tx.researchStudy.findUnique({ where: { id: studyId }, select: { marketId: true } });
    if (!study) throw notFound("Study");
    if (!study.marketId) return null;

    const { count } = await tx.market.updateMany({
      where: { id: study.marketId, status: MarketStatus.OPEN },
      data: { status: MarketStatus.CLOSED },
    });
    const market = await tx.market.findUniqueOrThrow({ where: { id: study.marketId } });
    if (count === 1) {
      await recordAudit(
        {
          actorId: input.closedById,
          organizationId: market.organizationId,
          action: "market.closeFromStudy",
          entityType: "Market",
          entityId: market.id,
          data: { studyId, reason: input.reason ?? null },
        },
        tx,
      );
    }
    return market;
  });
}

/**
 * Closes every OPEN market whose deadline has passed. Intended for a cron job.
 * Forecast submission must still check `closesAt > now` itself.
 */
export async function closeExpiredMarkets(now = new Date()) {
  const { count } = await db.market.updateMany({
    where: { status: MarketStatus.OPEN, closesAt: { lte: now } },
    data: { status: MarketStatus.CLOSED },
  });
  return count;
}

export async function listAdminMarkets(
  actor: SessionUser,
  opts: { status?: MarketStatus; startupId?: string; q?: string } = {},
): Promise<AdminMarketSummary[]> {
  assertAdmin(actor);
  const rows = await db.market.findMany({
    where: {
      status: opts.status,
      startupId: opts.startupId,
      ...(opts.q ? { question: { contains: opts.q, mode: "insensitive" } } : {}),
    },
    orderBy: [{ status: "asc" }, { closesAt: "asc" }],
    include: {
      startup: { select: { id: true, name: true, slug: true } },
      resolution: { select: { outcome: true, settlementStatus: true, resolvedAt: true } },
    },
  });
  return rows.map((m) => ({
    id: m.id,
    slug: m.slug,
    question: m.question,
    status: m.status,
    visibility: m.visibility,
    startup: m.startup,
    openingBaseline: m.openingBaseline,
    opensAt: m.opensAt.toISOString(),
    closesAt: m.closesAt.toISOString(),
    forecastCount: m.forecastCount,
    resolution: m.resolution
      ? { ...m.resolution, resolvedAt: m.resolution.resolvedAt.toISOString() }
      : null,
  }));
}

export async function getAdminMarket(actor: SessionUser, marketId: string) {
  assertAdmin(actor);
  const market = await db.market.findUnique({
    where: { id: marketId },
    include: {
      startup: { select: { id: true, name: true, slug: true } },
      organization: { select: { id: true, name: true, slug: true } },
      sources: { orderBy: { position: "asc" } },
      study: { select: { id: true, status: true } },
      resolution: { include: { resolvedBy: { select: { id: true, displayName: true } } } },
    },
  });
  if (!market) throw notFound("Market");
  return market;
}

// ---------------------------------------------------------------------------
// Credits & users
// ---------------------------------------------------------------------------

/** Admin grant or correction, written to the ledger and the audit log together. */
export async function adjustUserCredits(
  actor: SessionUser,
  input: AdminCreditAdjustmentInput,
  ctx: RequestContext = {},
): Promise<AppliedCreditTransaction> {
  assertAdmin(actor);
  const mutation = {
    userId: input.userId,
    amount: input.amount,
    type: input.type,
    idempotencyKey: `admin:${input.idempotencyKey}`,
    actorId: actor.id,
    memo: input.memo,
  };
  try {
    return await db.$transaction(async (tx) => {
      const result = await applyCreditTransaction(tx, mutation);
      if (result.replayed) return result;
      await recordAudit(
        {
          actorId: actor.id,
          action: "credits.adjust",
          entityType: "User",
          entityId: input.userId,
          data: { amount: input.amount, type: input.type, memo: input.memo, transactionId: result.transaction.id },
          ipAddress: ctx.ip,
        },
        tx,
      );
      if (input.amount > 0) {
        await tx.notification.create({
          data: {
            userId: input.userId,
            type: NotificationType.CREDITS_GRANTED,
            title: `You received ${input.amount} virtual credits`,
            body: input.memo,
          },
        });
      }
      return result;
    });
  } catch (error) {
    if (isUniqueViolation(error, "idempotencyKey")) {
      const existing = await db.creditTransaction.findUnique({
        where: { idempotencyKey: mutation.idempotencyKey },
      });
      if (existing) return { transaction: existing, replayed: true };
    }
    throw error;
  }
}

export async function setPlatformRole(
  actor: SessionUser,
  userId: string,
  platformRole: PlatformRole,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  if (userId === actor.id) throw invalidState("You cannot change your own platform role");
  return db.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: userId }, select: { platformRole: true } });
    if (!target) throw notFound("User");
    const user = await tx.user.update({
      where: { id: userId },
      data: { platformRole },
      select: { id: true, displayName: true, email: true, platformRole: true },
    });
    await recordAudit(
      {
        actorId: actor.id,
        action: "user.platformRole",
        entityType: "User",
        entityId: userId,
        data: { from: target.platformRole, to: platformRole },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return user;
  });
}

export async function searchUsersForAdmin(actor: SessionUser, opts: { q?: string; limit?: number } = {}) {
  assertAdmin(actor);
  return db.user.findMany({
    where: opts.q
      ? {
          OR: [
            { email: { contains: opts.q, mode: "insensitive" } },
            { displayName: { contains: opts.q, mode: "insensitive" } },
            { username: { contains: opts.q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
    take: opts.limit ?? 50,
    select: {
      id: true,
      email: true,
      displayName: true,
      username: true,
      platformRole: true,
      creditBalance: true,
      createdAt: true,
    },
  });
}

export async function listAuditLogs(
  actor: SessionUser,
  opts: { entityType?: string; entityId?: string; actorId?: string; action?: string; cursor?: string; limit: number },
) {
  assertAdmin(actor);
  const rows = await db.auditLog.findMany({
    where: {
      entityType: opts.entityType,
      entityId: opts.entityId,
      actorId: opts.actorId,
      action: opts.action,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export async function getAdminOverview(actor: SessionUser) {
  assertAdmin(actor);
  const [byStatus, pendingSettlements, users, startups, awaitingApproval] = await Promise.all([
    db.market.groupBy({ by: ["status"], _count: { _all: true } }),
    db.resolution.count({
      where: { settlementStatus: { in: [SettlementStatus.PENDING, SettlementStatus.FAILED] } },
    }),
    db.user.count(),
    db.startup.count(),
    db.resolutionProposal.count({ where: { status: "PROPOSED" } }),
  ]);
  const marketsByStatus = Object.fromEntries(
    Object.values(MarketStatus).map((s) => [s, byStatus.find((row) => row.status === s)?._count._all ?? 0]),
  ) as Record<MarketStatus, number>;
  return { marketsByStatus, pendingSettlements, users, startups, awaitingApproval };
}

/** Org names for picking the owner of a private market. Nothing else about the org. */
export async function listOrganizationNames(actor: SessionUser) {
  assertAdmin(actor);
  return db.organization.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
}

// Re-exported so existing imports from "@/lib/admin" keep working.
export {
  approveProposal,
  listResolutionProposals,
  proposeCorrection,
  proposeResolution,
  rejectProposal,
  resolveMarket,
  retrySettlement,
} from "@/lib/resolutions";
export {
  claimResolutionForSettlement,
  completeResolutionSettlement,
  failResolutionSettlement,
  runPendingSettlements,
  runSettlement,
} from "@/lib/settlement";
