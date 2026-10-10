import { ok, withVc } from "@/lib/vc/server/http";

export const dynamic = "force-dynamic";

/** DELETE /api/vc/watchlists/:watchlistId/items/:itemId */
export const DELETE = withVc<{ watchlistId: string; itemId: string }>(async ({ params, ctx, services }) => {
  await services.watchlists.removeItem(ctx, params.watchlistId, params.itemId);
  return ok({ deleted: true });
});
