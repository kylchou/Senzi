import { notFound, ok, withApiHandler } from "@/lib/api-response";
import { getMarket } from "@/lib/market-view/queries";

export const GET = withApiHandler(async (_req, { params }: RouteContext<"/api/markets/[slug]">) => {
  const market = await getMarket((await params).slug);
  if (!market) throw notFound("Market");
  return ok(market);
});
