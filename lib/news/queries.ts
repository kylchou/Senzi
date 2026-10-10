import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { newsItemSelect, toNewsItem } from "@/lib/market-view/mappers";
import type { NewsQuery } from "@/lib/discovery/params";
import type { CursorPage, NewsItemView } from "@/lib/market-view/types";
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

/** News filters for the /news page, always inside the public scope. */
export function newsFilter(params: Pick<NewsQuery, "verification" | "industry">): Prisma.NewsItemWhereInput {
  const and: Prisma.NewsItemWhereInput[] = [publicNewsWhere];
  if (params.verification === "verified") and.push({ verification: "VERIFIED" });
  if (params.verification === "reported") and.push({ verification: { not: "VERIFIED" } });
  if (params.industry) and.push({ startup: { industry: params.industry } });
  return { AND: and };
}

export async function listNewsPage(params: NewsQuery): Promise<CursorPage<NewsItemView>> {
  const where = newsFilter(params);
  const [rows, total] = await Promise.all([
    db.newsItem.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      select: newsItemSelect,
    }),
    db.newsItem.count({ where }),
  ]);
  const items = rows.slice(0, params.limit).map(toNewsItem);
  return { items, nextCursor: rows.length > params.limit ? items[items.length - 1].id : null, limit: params.limit, total };
}
