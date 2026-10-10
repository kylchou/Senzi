import { created, ok, parseJsonBody, withApiHandler } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { submitForecastForUser, submitForecastSchema } from "@/lib/forecasting/server/api";

/**
 * Places a forecast: spends `credits` on YES or NO at the current LMSR price.
 * Body: { marketId, side, credits, idempotencyKey, quotedPrice? }.
 * Resubmitting the same idempotencyKey returns the original receipt (200).
 */
export const POST = withApiHandler(async (req) => {
  const user = await requireUser();
  const input = await parseJsonBody(req, submitForecastSchema);
  const receipt = await submitForecastForUser(user, input);
  return receipt.replayed ? ok(receipt) : created(receipt);
});
