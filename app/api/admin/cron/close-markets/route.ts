import { timingSafeEqual } from "node:crypto";
import { ok, unauthenticated, withApiHandler } from "@/lib/api-response";
import { closeExpiredMarkets } from "@/lib/admin";

function hasCronSecret(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Vercel Cron: closes OPEN markets past their deadline. Requires CRON_SECRET. */
export const GET = withApiHandler(async (req) => {
  if (!hasCronSecret(req)) throw unauthenticated("Invalid cron secret");
  return ok({ closed: await closeExpiredMarkets() });
});
