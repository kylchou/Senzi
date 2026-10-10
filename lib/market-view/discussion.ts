import "server-only";
import { PlatformRole, VerificationStatus } from "@/generated/prisma/enums";
import { forbidden, invalidState, notFound } from "@/lib/api-response";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { PUBLIC_MARKET_WHERE } from "@/lib/permissions";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { SessionUser } from "@/lib/types";
import {
  REPLIES_PER_COMMENT,
  type CommentView,
  type DiscussionPage,
  type PostingState,
} from "./discussion-types";

/**
 * Market discussion threads. Anyone can read a public market's discussion;
 * posting needs a signed-in account that has finished onboarding. Authors
 * and platform admins can remove a comment. Only names, handles, and pictures
 * are ever returned: never emails, balances, or forecasts.
 */

export interface DiscussionMarket {
  id: string;
  startupId: string;
}

const authorSelect = { id: true, displayName: true, username: true, avatarUrl: true } as const;

const commentSelect = {
  id: true,
  body: true,
  createdAt: true,
  removedAt: true,
  userId: true,
  user: { select: authorSelect },
} as const;

type CommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  removedAt: Date | null;
  userId: string;
  user: { id: string; displayName: string; username: string | null; avatarUrl: string | null };
};

export async function findDiscussionMarket(slug: string): Promise<DiscussionMarket | null> {
  return db.market.findFirst({ where: { slug, ...PUBLIC_MARKET_WHERE }, select: { id: true, startupId: true } });
}

export function postingStateFor(viewer: SessionUser | null): PostingState {
  if (!viewer) return "signed-out";
  if (!viewer.accountType || !viewer.accountVerifiedAt) return "finish-onboarding";
  return "allowed";
}

const isAdmin = (viewer: SessionUser | null) => viewer?.platformRole === PlatformRole.ADMIN;

async function verifiedAuthors(startupId: string, userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db.productUserVerification.findMany({
    where: { startupId, status: VerificationStatus.APPROVED, userId: { in: userIds } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return new Set(rows.map((row) => row.userId));
}

function toView(row: CommentRow, verified: Set<string>, viewer: SessionUser | null, replies: CommentView[] = []): CommentView {
  const removed = row.removedAt !== null;
  return {
    id: row.id,
    body: removed ? null : row.body,
    createdAt: row.createdAt.toISOString(),
    removed,
    author: removed
      ? null
      : {
          id: row.user.id,
          name: row.user.displayName,
          username: row.user.username,
          avatarUrl: row.user.avatarUrl,
          verified: verified.has(row.userId),
        },
    canRemove: !removed && (row.userId === viewer?.id || isAdmin(viewer)),
    replies,
  };
}

/** Newest top-level comments first, each with its replies oldest first. */
export async function listComments(
  market: DiscussionMarket,
  viewer: SessionUser | null,
  { cursor, limit }: { cursor?: string; limit: number },
): Promise<DiscussionPage> {
  const [rows, total] = await Promise.all([
    db.marketComment.findMany({
      where: { marketId: market.id, parentId: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        ...commentSelect,
        replies: {
          where: { removedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: REPLIES_PER_COMMENT,
          select: commentSelect,
        },
      },
    }),
    db.marketComment.count({ where: { marketId: market.id, removedAt: null } }),
  ]);

  const page = rows.slice(0, limit);
  const authorIds = [...new Set(page.flatMap((row) => [row.userId, ...row.replies.map((reply) => reply.userId)]))];
  const verified = await verifiedAuthors(market.startupId, authorIds);

  const comments = page
    // A removed comment only stays as a placeholder while it still has replies.
    .filter((row) => row.removedAt === null || row.replies.length > 0)
    .map((row) =>
      toView(
        row,
        verified,
        viewer,
        row.replies.map((reply) => toView(reply, verified, viewer)),
      ),
    );

  return {
    comments,
    total,
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    posting: postingStateFor(viewer),
    viewer: viewer ? { name: viewer.displayName, avatarUrl: viewer.avatarUrl } : null,
  };
}

export async function createComment(
  market: DiscussionMarket,
  user: SessionUser,
  input: { body: string; parentId?: string },
): Promise<CommentView> {
  const state = postingStateFor(user);
  if (state === "finish-onboarding") throw forbidden("Finish setting up your account to comment");
  await rateLimit(`market-comment:${user.id}`, RATE_LIMITS.commentPost);

  if (input.parentId) {
    const parent = await db.marketComment.findFirst({
      where: { id: input.parentId, marketId: market.id },
      select: { parentId: true, removedAt: true },
    });
    if (!parent) throw notFound("Comment");
    if (parent.parentId !== null) throw invalidState("Replies go under the original comment");
    if (parent.removedAt) throw invalidState("That comment was removed");
  }

  const row = await db.marketComment.create({
    data: { marketId: market.id, userId: user.id, parentId: input.parentId ?? null, body: input.body },
    select: commentSelect,
  });
  const verified = await verifiedAuthors(market.startupId, [user.id]);
  return toView(row, verified, user);
}

export async function removeComment(
  market: DiscussionMarket,
  user: SessionUser,
  commentId: string,
  ipAddress: string | null = null,
): Promise<void> {
  const comment = await db.marketComment.findFirst({
    where: { id: commentId, marketId: market.id },
    select: { userId: true, removedAt: true },
  });
  if (!comment) throw notFound("Comment");
  const own = comment.userId === user.id;
  if (!own && !isAdmin(user)) throw forbidden("You can only remove your own comments");
  if (comment.removedAt) return;

  await db.$transaction(async (tx) => {
    await tx.marketComment.update({
      where: { id: commentId },
      data: { body: "", removedAt: new Date(), removedById: user.id },
    });
    // Admin removals of someone else's comment are audited.
    if (!own) {
      await recordAudit(
        {
          actorId: user.id,
          action: "market_comment.remove",
          entityType: "MarketComment",
          entityId: commentId,
          data: { marketId: market.id, authorId: comment.userId },
          ipAddress,
        },
        tx,
      );
    }
  });
}
