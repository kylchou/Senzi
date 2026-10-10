import { ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { reviewVerificationSchema } from "@/lib/validation";
import { reviewVcVerification } from "@/lib/verification";

/** Body: { decision: "APPROVED" | "REJECTED", note? }. A note is required to reject. */
export const POST = withApiHandler(async (req, ctx: RouteContext<"/api/admin/verifications/[id]/review">) => {
  const admin = await requirePlatformAdmin();
  await rateLimit(`verification-review:${admin.id}`, RATE_LIMITS.resolutionReview);
  const { id } = await ctx.params;
  const input = await parseJsonBody(req, reviewVerificationSchema);
  return ok(await reviewVcVerification(admin, id, input, { ip: clientIp(req) }));
});
