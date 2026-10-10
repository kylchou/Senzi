import { created, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { proposeResolution } from "@/lib/resolutions";
import { proposeResolutionSchema } from "@/lib/validation";

/**
 * Proposes an outcome with evidence. Nothing is final until a different
 * admin approves it at POST /api/admin/resolution-proposals/:id/approve.
 * The market closes to new forecasts while the proposal is reviewed.
 */
export const POST = withApiHandler(async (req, ctx: RouteContext<"/api/admin/markets/[id]/resolve">) => {
  const admin = await requirePlatformAdmin();
  await rateLimit(`resolution:${admin.id}`, RATE_LIMITS.resolutionReview);
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, proposeResolutionSchema);
  return created(await proposeResolution(admin, id, input, { ip: clientIp(req) }));
});
