import { VerificationStatus } from "@/generated/prisma/enums";
import { ok, withApiHandler } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/auth";
import { listVcVerifications } from "@/lib/verification";

/** VC verification requests. ?status=PENDING (default), APPROVED, or REJECTED. */
export const GET = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  const raw = new URL(req.url).searchParams.get("status");
  const status = Object.values(VerificationStatus).find((s) => s === raw) ?? VerificationStatus.PENDING;
  return ok(await listVcVerifications(admin, status));
});
