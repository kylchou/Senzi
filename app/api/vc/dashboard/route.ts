import { ok, withVc } from "@/lib/vc/server/http";

/** GET /api/vc/dashboard — dashboard for the active organization. */
export const GET = withVc(async ({ ctx, services }) => ok(await services.dashboard.get(ctx)));
