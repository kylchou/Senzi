import { ok, parseBody, withVc } from "@/lib/vc/server/http";
import { createWatchlistInput } from "@/lib/vc/validation";

export const dynamic = "force-dynamic";

/** GET /api/vc/watchlists — the active organization's watchlists with current estimates. */
export const GET = withVc(async ({ ctx, services }) => ok(await services.watchlists.list(ctx)));

/** POST /api/vc/watchlists — { name } */
export const POST = withVc(async ({ req, ctx, services }) => {
  const { name } = await parseBody(req, createWatchlistInput);
  return ok(await services.watchlists.create(ctx, name), { status: 201 });
});
