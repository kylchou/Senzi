import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { newsItemSelect, toNewsItem } from "@/lib/market-view/mappers";
import type { NewsItemView } from "@/lib/market-view/types";
import { PUBLIC_MARKET_WHERE, PUBLIC_STARTUP_WHERE } from "@/lib/permissions";

/**
 * News that is safe on public pages: not tied to an unpublished startup, and
 * not tied to a market that is private, unlisted, or a draft.
 */
export const publicNewsWhere = {
  AND: [
    { OR: [{ startupId: null }, { startup: PUBLIC_STARTUP_WHERE }] },
    { OR: [{ marketId: null }, { market: PUBLIC_MARKET_WHERE }] },
  ],
} satisfies Prisma.NewsItemWhereInput;

export async function listNews({ startupId, limit = 8 }: { startupId?: string; limit?: number } = {}): Promise<NewsItemView[]> {
  const rows = await db.newsItem.findMany({
    where: startupId ? { AND: [publicNewsWhere, { startupId }] } : publicNewsWhere,
    orderBy: { publishedAt: "desc" },
    take: limit,
    select: newsItemSelect,
  });
  return rows.map(toNewsItem);
}
