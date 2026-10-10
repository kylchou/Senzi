import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { marketQuerySchema } from "@/lib/discovery/params";
import { listMarkets } from "@/lib/market-view/queries";

/** Public market listing. Drafts, VC markets, and unpublished startups are never included. */
export const GET = withApiHandler(async (req) => {
  const { items, nextCursor, limit } = await listMarkets(parseSearchParams(req, marketQuerySchema));
  return ok(items, { nextCursor, limit });
});
