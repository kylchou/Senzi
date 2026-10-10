import { ok, parseBody, parseQuery, withVc } from "@/lib/vc/server/http";
import { alertListQuery, markAlertsReadInput } from "@/lib/vc/validation";

export const dynamic = "force-dynamic";

/** GET /api/vc/alerts?unreadOnly=true&type=FORECAST_MOVEMENT&limit=50 */
export const GET = withVc(async ({ req, ctx, services }) => {
  const query = parseQuery(req, alertListQuery);
  return ok(await services.alerts.list(ctx, query));
});

/** PATCH /api/vc/alerts — { alertIds } marks alerts read for the current user. */
export const PATCH = withVc(async ({ req, ctx, services }) => {
  const { alertIds } = await parseBody(req, markAlertsReadInput);
  await services.alerts.markRead(ctx, alertIds);
  return ok({ updated: alertIds.length });
});
