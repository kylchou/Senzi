import { ok, withApiHandler } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { portfolioForUser } from "@/lib/forecasting/server/api";

/** The signed-in user's balance, positions, ledger history and virtual results. */
export const GET = withApiHandler(async () => {
  const user = await requireUser();
  return ok(await portfolioForUser(user));
});
