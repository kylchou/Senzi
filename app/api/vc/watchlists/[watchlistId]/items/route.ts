import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { watchlistItemInput } from "@/lib/vc/validation";

export const dynamic = "force-dynamic";

/** POST /api/vc/watchlists/:watchlistId/items — { type: "STARTUP", startupId } | { type: "STUDY", studyId } */
export const POST = withVc<{ watchlistId: string }>(async ({ req, params, ctx, services }) => {
  const input = await parseBody(req, watchlistItemInput);
  return ok(await services.watchlists.addItem(ctx, params.watchlistId, input), { status: 201 });
});
