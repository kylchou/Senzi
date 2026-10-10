import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { startupQuerySchema } from "@/lib/discovery/params";
import { listStartups } from "@/lib/discovery/queries";

/** Public startup directory. Unpublished startups are never included. */
export const GET = withApiHandler(async (req) => {
  const { items, nextCursor, limit } = await listStartups(parseSearchParams(req, startupQuerySchema));
  return ok(items, { nextCursor, limit });
});
