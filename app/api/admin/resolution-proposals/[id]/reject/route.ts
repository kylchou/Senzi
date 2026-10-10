import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { rejectProposal } from "@/lib/resolutions";
import { rejectProposalSchema } from "@/lib/validation";

/** Rejects a proposal, or withdraws your own. Body: { reason } */
export const POST = withApiHandler(async (req, ctx: RouteContext<"/api/admin/resolution-proposals/[id]/reject">) => {
  const admin = await requirePlatformAdmin();
  await rateLimit(`resolution:${admin.id}`, RATE_LIMITS.resolutionReview);
  const { id } = await ctx.params;
  const { reason } = await parseJsonBody(req, rejectProposalSchema);
  return ok(await rejectProposal(admin, id, reason, { ip: clientIp(req) }));
});
