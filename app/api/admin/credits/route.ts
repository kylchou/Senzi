import { created, ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { adjustUserCredits } from "@/lib/admin";
import { clientIp } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth";
import { toCreditTransactionDTO } from "@/lib/credits";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { adminCreditAdjustmentSchema } from "@/lib/validation";

/**
 * Grants or corrects virtual credits. Retrying with the same idempotencyKey
 * returns the original transaction (200) instead of creating a new one (201).
 */
export const POST = withApiHandler(async (req) => {
  const admin = await requirePlatformAdmin();
  await rateLimit(`credit-adjust:${admin.id}`, RATE_LIMITS.creditAdjust);
  const input = await parseJsonBody(req, adminCreditAdjustmentSchema);
  const result = await adjustUserCredits(admin, input, { ip: clientIp(req) });
  const body = { transaction: toCreditTransactionDTO(result.transaction), replayed: result.replayed };
  return result.replayed ? ok(body) : created(body);
});
