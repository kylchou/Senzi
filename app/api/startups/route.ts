import { connection } from "next/server";
import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { startupQuerySchema } from "@/lib/discovery/params";
import { listStartups } from "@/lib/discovery/queries";

const handler = withApiHandler(async (req) => {
  const { items, nextCursor, limit } = await listStartups(parseSearchParams(req, startupQuerySchema));
  return ok(items, { nextCursor, limit });
});

/**
 * Public startup directory. Unpublished startups are never included.
 * connection() runs outside withApiHandler (see app/api/markets/route.ts).
 */
export async function GET(req: Request) {
  await connection();
  return handler(req, undefined);
}
