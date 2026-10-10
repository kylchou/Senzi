import { notFound, ok, withApiHandler } from "@/lib/api-response";
import { getMarket, getMarketHistory } from "@/lib/market-view/queries";

export const GET = withApiHandler(async (_req, { params }: RouteContext<"/api/markets/[slug]/history">) => {
  const market = await getMarket((await params).slug);
  if (!market) throw notFound("Market");
  return ok({ marketId: market.id, openingBaseline: market.openingBaseline, points: await getMarketHistory(market.id) });
});
