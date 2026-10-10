import { created, ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { clientIp } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { vcVerificationSchema } from "@/lib/validation";
import { latestVcVerification, submitVcVerification } from "@/lib/verification";

/** Your latest VC verification request, or null. */
export const GET = withApiHandler(async () => {
  const user = await requireUser();
  return ok(await latestVcVerification(user.id));
});

/** Sends firm details for review. VC accounts only, one pending request at a time. */
export const POST = withApiHandler(async (req) => {
  const user = await requireUser();
  await rateLimit(`verification:${user.id}`, RATE_LIMITS.verificationSubmit);
  const input = await parseJsonBody(req, vcVerificationSchema);
  return created(await submitVcVerification(user, input, { ip: clientIp(req) }));
});
