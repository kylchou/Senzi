import { z } from "zod";
import { PUBLIC_MARKET_STATUSES } from "@/lib/market-view/types";

export const MARKET_SORTS = ["closing", "active", "newest"] as const;
export type MarketSort = (typeof MARKET_SORTS)[number];

/** Cards per page on the community pages. */
export const PAGE_SIZE = 12;
/** API default and ceiling, matching paginationSchema in lib/validation.ts. */
export const API_DEFAULT_LIMIT = 20;
export const API_MAX_LIMIT = 100;

type RawParams = Record<string, string | string[] | undefined> | URLSearchParams;

function first(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const value = raw[key];
  return Array.isArray(value) ? value[0] : value;
}

const fields = {
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => value || undefined),
  status: z.enum(PUBLIC_MARKET_STATUSES).optional(),
  industry: z.string().trim().min(1).max(60).optional(),
  sort: z.enum(MARKET_SORTS).default("closing"),
  cursor: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(API_MAX_LIMIT),
};

/** Strict schemas for the public API. Invalid input becomes a 400 VALIDATION_ERROR. */
export const marketQuerySchema = z.object({
  q: fields.q,
  status: fields.status,
  industry: fields.industry,
  sort: fields.sort,
  cursor: fields.cursor,
  limit: fields.limit.default(API_DEFAULT_LIMIT),
});
export type MarketQuery = z.output<typeof marketQuerySchema>;

export const startupQuerySchema = z.object({
  q: fields.q,
  industry: fields.industry,
  cursor: fields.cursor,
  limit: fields.limit.default(API_DEFAULT_LIMIT),
});
export type StartupQuery = z.output<typeof startupQuerySchema>;

/** Page parsers: invalid values fall back to defaults so a bad link still renders. */
export function parseMarketParams(raw: RawParams): MarketQuery {
  return {
    q: fields.q.catch(undefined).parse(first(raw, "q")),
    status: fields.status.catch(undefined).parse(first(raw, "status") || undefined),
    industry: fields.industry.catch(undefined).parse(first(raw, "industry") || undefined),
    sort: fields.sort.catch("closing").parse(first(raw, "sort")),
    cursor: fields.cursor.catch(undefined).parse(first(raw, "cursor") || undefined),
    limit: PAGE_SIZE,
  };
}

export function parseStartupParams(raw: RawParams): StartupQuery {
  return {
    q: fields.q.catch(undefined).parse(first(raw, "q")),
    industry: fields.industry.catch(undefined).parse(first(raw, "industry") || undefined),
    cursor: fields.cursor.catch(undefined).parse(first(raw, "cursor") || undefined),
    limit: PAGE_SIZE,
  };
}

export function parseSearchQuery(raw: RawParams): string | undefined {
  return fields.q.catch(undefined).parse(first(raw, "q"));
}

/** Builds a query string from params, dropping empty values. */
export function toQueryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}
