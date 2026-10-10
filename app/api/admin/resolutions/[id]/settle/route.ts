import { ok, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { retrySettlement } from "@/lib/resolutions";

/** Runs (or retries) settlement for an approved resolution. Safe to repeat. */
export const POST = withApiHandler(async (req, ctx: RouteContext<"/api/admin/resolutions/[id]/settle">) => {
  const admin = await requirePlatformAdmin();
  const { id } = await ctx.params;
  return ok(await retrySettlement(admin, id, { ip: clientIp(req) }));
});
