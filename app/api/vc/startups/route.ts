import { forbidden } from "@/lib/vc/errors";
import { getVcDeps } from "@/lib/vc/server/container";
import { ok, parseQuery, withVc } from "@/lib/vc/server/http";
import { startupSearchQuery } from "@/lib/vc/validation";

export const dynamic = "force-dynamic";

/** GET /api/vc/startups?q= — startup lookup for study and watchlist forms (VC members only). */
export const GET = withVc(async ({ req, ctx }) => {
  if (ctx.memberships.length === 0) throw forbidden();
  const { q } = parseQuery(req, startupSearchQuery);
  return ok(await getVcDeps().platform.searchStartups(q, 10));
});
