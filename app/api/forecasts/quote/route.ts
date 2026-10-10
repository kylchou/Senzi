import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { getCurrentUser } from "@/lib/auth";
import { quoteForUser, quoteSchema } from "@/lib/forecasting/server/api";

/** What spending `credits` on `side` would get right now. Not binding. Query: marketId, side, credits. */
export const GET = withApiHandler(async (req) => {
  const input = parseSearchParams(req, quoteSchema);
  const user = await getCurrentUser();
  return ok(await quoteForUser(user?.id ?? null, input));
});
