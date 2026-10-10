import type { NewsVerification } from "@/generated/prisma/enums";
import { notFound } from "@/lib/api-response";
import { assertAdmin } from "@/lib/admin";
import { recordAudit } from "@/lib/audit";
import { db, type TxClient } from "@/lib/db";
import type { RequestContext, SessionUser } from "@/lib/types";
import type {
  NewsItemInput,
  StartupFactInput,
  UpdateNewsItemInput,
  UpdateStartupFactInput,
} from "@/lib/validation";

/**
 * Admin management of public content: sourced startup facts and news.
 * Verification is an admin decision, so every change (including flipping
 * verified/unverified) is audit-logged with who made it.
 */

// ---------------------------------------------------------------------------
// Startup facts
// ---------------------------------------------------------------------------

export async function listStartupFacts(actor: SessionUser, startupId: string) {
  assertAdmin(actor);
  return db.startupFact.findMany({ where: { startupId }, orderBy: [{ asOf: "desc" }, { label: "asc" }] });
}

export async function createStartupFact(
  actor: SessionUser,
  startupId: string,
  input: StartupFactInput,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const startup = await tx.startup.findUnique({ where: { id: startupId }, select: { id: true } });
    if (!startup) throw notFound("Startup");
    const fact = await tx.startupFact.create({ data: { ...input, startupId } });
    await recordAudit(
      {
        actorId: actor.id,
        action: "startupFact.create",
        entityType: "StartupFact",
        entityId: fact.id,
        data: { startupId, label: fact.label, verified: fact.verified },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return fact;
  });
}

export async function updateStartupFact(
  actor: SessionUser,
  factId: string,
  input: UpdateStartupFactInput,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const before = await tx.startupFact.findUnique({ where: { id: factId } });
    if (!before) throw notFound("Fact");
    const fact = await tx.startupFact.update({ where: { id: factId }, data: input });
    await recordAudit(
      {
        actorId: actor.id,
        action: input.verified !== undefined && input.verified !== before.verified ? "startupFact.verify" : "startupFact.update",
        entityType: "StartupFact",
        entityId: factId,
        data: { changed: Object.keys(input), verified: { from: before.verified, to: fact.verified } },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return fact;
  });
}

export async function deleteStartupFact(actor: SessionUser, factId: string, ctx: RequestContext = {}) {
  assertAdmin(actor);
  await db.$transaction(async (tx) => {
    const fact = await tx.startupFact.findUnique({ where: { id: factId } });
    if (!fact) throw notFound("Fact");
    await tx.startupFact.delete({ where: { id: factId } });
    await recordAudit(
      {
        actorId: actor.id,
        action: "startupFact.delete",
        entityType: "StartupFact",
        entityId: factId,
        // Keep what was deleted so the audit trail can explain it later.
        data: { startupId: fact.startupId, label: fact.label, value: fact.value, sourceUrl: fact.sourceUrl },
        ipAddress: ctx.ip,
      },
      tx,
    );
  });
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

async function assertNewsReferences(tx: TxClient, refs: { startupId?: string | null; marketId?: string | null }) {
  if (refs.startupId) {
    const startup = await tx.startup.findUnique({ where: { id: refs.startupId }, select: { id: true } });
    if (!startup) throw notFound("Startup");
  }
  if (refs.marketId) {
    const market = await tx.market.findUnique({ where: { id: refs.marketId }, select: { id: true } });
    if (!market) throw notFound("Market");
  }
}

export async function listAdminNews(
  actor: SessionUser,
  opts: { q?: string; startupId?: string; verification?: NewsVerification } = {},
) {
  assertAdmin(actor);
  return db.newsItem.findMany({
    where: {
      startupId: opts.startupId,
      verification: opts.verification,
      ...(opts.q ? { title: { contains: opts.q, mode: "insensitive" } } : {}),
    },
    orderBy: { publishedAt: "desc" },
    take: 200,
    include: { startup: { select: { id: true, name: true } } },
  });
}

export async function getAdminNewsItem(actor: SessionUser, newsId: string) {
  assertAdmin(actor);
  const item = await db.newsItem.findUnique({ where: { id: newsId } });
  if (!item) throw notFound("News item");
  return item;
}

export async function createNewsItem(actor: SessionUser, input: NewsItemInput, ctx: RequestContext = {}) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    await assertNewsReferences(tx, input);
    const item = await tx.newsItem.create({ data: { ...input, createdById: actor.id } });
    await recordAudit(
      {
        actorId: actor.id,
        action: "news.create",
        entityType: "NewsItem",
        entityId: item.id,
        data: { title: item.title, url: item.url, verification: item.verification },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return item;
  });
}

export async function updateNewsItem(
  actor: SessionUser,
  newsId: string,
  input: UpdateNewsItemInput,
  ctx: RequestContext = {},
) {
  assertAdmin(actor);
  return db.$transaction(async (tx) => {
    const before = await tx.newsItem.findUnique({ where: { id: newsId } });
    if (!before) throw notFound("News item");
    await assertNewsReferences(tx, input);
    const item = await tx.newsItem.update({ where: { id: newsId }, data: input });
    const verificationChanged = input.verification !== undefined && input.verification !== before.verification;
    await recordAudit(
      {
        actorId: actor.id,
        action: verificationChanged ? "news.verify" : "news.update",
        entityType: "NewsItem",
        entityId: newsId,
        data: { changed: Object.keys(input), verification: { from: before.verification, to: item.verification } },
        ipAddress: ctx.ip,
      },
      tx,
    );
    return item;
  });
}

export async function deleteNewsItem(actor: SessionUser, newsId: string, ctx: RequestContext = {}) {
  assertAdmin(actor);
  await db.$transaction(async (tx) => {
    const item = await tx.newsItem.findUnique({ where: { id: newsId } });
    if (!item) throw notFound("News item");
    await tx.newsItem.delete({ where: { id: newsId } });
    await recordAudit(
      {
        actorId: actor.id,
        action: "news.delete",
        entityType: "NewsItem",
        entityId: newsId,
        data: { title: item.title, url: item.url, startupId: item.startupId },
        ipAddress: ctx.ip,
      },
      tx,
    );
  });
}
