import { parseCompareIds } from "@/lib/vc/compare";
import { ok, withVc } from "@/lib/vc/server/http";

/** GET /api/vc/compare?startupIds=a,b[,c,d] — side-by-side comparison of 2–4 published startups. */
export const GET = withVc(async ({ req, ctx, services }) => {
  const ids = parseCompareIds(req.nextUrl.searchParams.get("startupIds") ?? undefined);
  return ok(await services.compare.compare(ctx, ids));
});
