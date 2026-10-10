import { ok, withVc } from "@/lib/vc/server/http";

export const dynamic = "force-dynamic";

/** GET /api/vc/dashboard — dashboard for the active organization. */
export const GET = withVc(async ({ ctx, services }) => ok(await services.dashboard.get(ctx)));
