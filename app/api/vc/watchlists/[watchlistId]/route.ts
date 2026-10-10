import { ok, withVc } from "@/lib/vc/server/http";

export const dynamic = "force-dynamic";

/** DELETE /api/vc/watchlists/:watchlistId */
export const DELETE = withVc<{ watchlistId: string }>(async ({ params, ctx, services }) => {
  await services.watchlists.remove(ctx, params.watchlistId);
  return ok({ deleted: true });
});
