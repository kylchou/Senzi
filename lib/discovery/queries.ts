import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { listMarkets, listMarketsForStartup } from "@/lib/market-view/queries";
import type { CursorPage, MarketSummary, StartupProfile, StartupSummary } from "@/lib/market-view/types";
import { listNews } from "@/lib/news/queries";
import { PUBLIC_MARKET_WHERE, PUBLIC_STARTUP_WHERE } from "@/lib/permissions";
import type { StartupQuery } from "./params";

const startupSummarySelect = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  sector: true,
  stage: true,
  headquarters: true,
  foundedYear: true,
  logoUrl: true,
  _count: { select: { markets: { where: { AND: [PUBLIC_MARKET_WHERE, { status: "OPEN" }] } } } },
} satisfies Prisma.StartupSelect;

type StartupSummaryRow = Prisma.StartupGetPayload<{ select: typeof startupSummarySelect }>;

function toStartupSummary(row: StartupSummaryRow): StartupSummary {
  return {
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    sector: row.sector,
    stage: row.stage,
    headquarters: row.headquarters,
    foundedYear: row.foundedYear,
    logoUrl: row.logoUrl,
    openMarketCount: row._count.markets,
  };
}

export function publicStartupFilter(params: Pick<StartupQuery, "q" | "sector">): Prisma.StartupWhereInput {
  const and: Prisma.StartupWhereInput[] = [PUBLIC_STARTUP_WHERE];
  if (params.q) {
    and.push({
      OR: [
        { name: { contains: params.q, mode: "insensitive" } },
        { tagline: { contains: params.q, mode: "insensitive" } },
        { sector: { contains: params.q, mode: "insensitive" } },
      ],
    });
  }
  if (params.sector) and.push({ sector: params.sector });
  return { AND: and };
}

export async function listStartups(params: StartupQuery): Promise<CursorPage<StartupSummary>> {
  const where = publicStartupFilter(params);
  const [rows, total] = await Promise.all([
    db.startup.findMany({
      where,
      select: startupSummarySelect,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    }),
    db.startup.count({ where }),
  ]);
  const page = rows.slice(0, params.limit);
  return {
    items: page.map(toStartupSummary),
    nextCursor: rows.length > params.limit ? page[page.length - 1].id : null,
    limit: params.limit,
    total,
  };
}

export async function listFeaturedStartups(limit = 4): Promise<StartupSummary[]> {
  const rows = await db.startup.findMany({
    where: PUBLIC_STARTUP_WHERE,
    select: startupSummarySelect,
    orderBy: [{ markets: { _count: "desc" } }, { name: "asc" }],
    take: limit,
  });
  return rows.map(toStartupSummary);
}

export async function listSectors(): Promise<string[]> {
  const rows = await db.startup.findMany({
    where: PUBLIC_STARTUP_WHERE,
    distinct: ["sector"],
    select: { sector: true },
    orderBy: { sector: "asc" },
  });
  return rows.map((row) => row.sector);
}

export const getStartupProfile = cache(async (slug: string): Promise<StartupProfile | null> => {
  const row = await db.startup.findFirst({
    where: { AND: [{ slug }, PUBLIC_STARTUP_WHERE] },
    select: { ...startupSummarySelect, description: true, website: true },
  });
  if (!row) return null;

  const [markets, news] = await Promise.all([listMarketsForStartup(row.id), listNews({ startupId: row.id, limit: 6 })]);
  return { ...toStartupSummary(row), description: row.description, website: row.website, markets, news };
});

export async function searchAll(q: string): Promise<{ markets: MarketSummary[]; startups: StartupSummary[] }> {
  const [markets, startups] = await Promise.all([
    listMarkets({ q, sort: "closing", limit: 12, status: undefined, sector: undefined, cursor: undefined }),
    listStartups({ q, limit: 12, sector: undefined, cursor: undefined }),
  ]);
  return { markets: markets.items, startups: startups.items };
}
