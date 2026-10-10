import { created, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { proposeCorrection } from "@/lib/resolutions";
import { proposeCorrectionSchema } from "@/lib/validation";

/**
 * Proposes a correction to an approved resolution, with a reason. Needs a
 * second admin's approval. The outcome can only change before credits settle.
 */
export const POST = withApiHandler(async (req, ctx: RouteContext<"/api/admin/resolutions/[id]/corrections">) => {
  const admin = await requirePlatformAdmin();
  await rateLimit(`resolution:${admin.id}`, RATE_LIMITS.resolutionReview);
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, proposeCorrectionSchema);
  return created(await proposeCorrection(admin, id, input, { ip: clientIp(req) }));
});
