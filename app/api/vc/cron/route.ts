import type { NextRequest } from "next/server";
import { refreshMarketModels } from "@/lib/model/market-refresh";
import { getVcServices } from "@/lib/vc/server/container";
import { errorResponse, isAuthorizedCron, ok } from "@/lib/vc/server/http";

/**
 * GET /api/vc/cron — scheduled job (Authorization: Bearer $CRON_SECRET).
 * Syncs study status with market state (deadline close, resolution),
 * publishes newer model estimates to open study markets and to open
 * traffic-rank markets (lib/model/market-refresh.ts), and generates
 * watchlist alerts. Idempotent; safe to retry.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return Response.json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } }, { status: 401 });
  }
  try {
    const services = getVcServices();
    const sync = await services.studies.syncWithMarkets();
    const modelLines = await services.openingLine.refreshOpenMarkets();
    const marketModels = await refreshMarketModels();
    const alerts = await services.alerts.evaluate();
    return ok({ sync, modelLines, marketModels, alerts });
  } catch (err) {
    return errorResponse(err);
  }
}
