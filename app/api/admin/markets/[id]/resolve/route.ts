import { created, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { resolveMarket } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { resolveMarketSchema } from "@/lib/validation";

/**
 * Records the outcome with evidence. The resolution comes back with
 * settlementStatus "PENDING"; the forecasting engine settles the credits.
 */
export const POST = withApiHandler(async (req, ctx: RouteContext<"/api/admin/markets/[id]/resolve">) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, resolveMarketSchema);
  return created(await resolveMarket(admin, id, input, { ip: clientIp(req) }));
});
