import { notFound, ok, withApiHandler } from "@/lib/api-response";
import { getReplayData } from "@/lib/market-view/replay-data";

/** Market Replay data for a public market: signal history, events, and aggregated activity. */
export const GET = withApiHandler(async (_req, { params }: RouteContext<"/api/markets/[slug]/replay">) => {
  const data = await getReplayData((await params).slug, Date.now());
  if (!data) throw notFound("Market");
  return ok(data);
});
