import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { watchlistItemInput } from "@/lib/vc/validation";

/**
 * POST /api/vc/follows — follow a startup or study. Body: { type: "STARTUP", startupId } | { type: "STUDY", studyId }.
 * DELETE /api/vc/follows — stop following it (same body).
 * The firm has one watchlist; there are no lists to manage.
 */
export const POST = withVc(async ({ req, ctx, services }) => {
  await services.watchlists.follow(ctx, await parseBody(req, watchlistItemInput));
  return ok({ following: true });
});

export const DELETE = withVc(async ({ req, ctx, services }) => {
  await services.watchlists.unfollow(ctx, await parseBody(req, watchlistItemInput));
  return ok({ following: false });
});
