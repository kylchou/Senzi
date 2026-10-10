import { connection } from "next/server";
import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { marketQuerySchema } from "@/lib/discovery/params";
import { listMarkets } from "@/lib/market-view/queries";

const handler = withApiHandler(async (req) => {
  const { items, nextCursor, limit } = await listMarkets(parseSearchParams(req, marketQuerySchema));
  return ok(items, { nextCursor, limit });
});

/**
 * Public market listing. Drafts, unlisted, and private markets are never included.
 * connection() runs outside withApiHandler so Next's build-time prerender signal
 * is not caught and logged as an error.
 */
export async function GET(req: Request) {
  await connection();
  return handler(req, undefined);
}
