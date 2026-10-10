import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { approveProposal } from "@/lib/resolutions";
import { approveProposalSchema } from "@/lib/validation";

/**
 * Approves a proposal (not your own). Returns the resolution and the
 * settlement attempt; a failed settlement stays FAILED for retry.
 */
export const POST = withApiHandler(async (req, ctx: RouteContext<"/api/admin/resolution-proposals/[id]/approve">) => {
  const admin = await requirePlatformAdmin();
  await rateLimit(`resolution:${admin.id}`, RATE_LIMITS.resolutionReview);
  const { id } = await ctx.params;
  const { note } = await parseJsonBody(req, approveProposalSchema);
  return ok(await approveProposal(admin, id, { note }, { ip: clientIp(req) }));
});
