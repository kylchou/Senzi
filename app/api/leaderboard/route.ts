import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { leaderboard, leaderboardSchema } from "@/lib/forecasting/server/api";

/** Public leaderboard. Query: metric (net_result | accuracy | resolved_forecasts), limit. */
export const GET = withApiHandler(async (req) => ok(await leaderboard(parseSearchParams(req, leaderboardSchema))));
