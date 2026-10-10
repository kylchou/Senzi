import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { getAdminMarket, updateMarket } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { updateMarketSchema } from "@/lib/validation";

type Ctx = RouteContext<"/api/admin/markets/[id]">;

export const GET = withApiHandler(async (_req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  return ok(await getAdminMarket(admin, id));
});

/** Question, criteria, baseline, and visibility lock once anyone has forecast. */
export const PATCH = withApiHandler(async (req, ctx: Ctx) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, updateMarketSchema);
  return ok(await updateMarket(admin, id, input, { ip: clientIp(req) }));
});
