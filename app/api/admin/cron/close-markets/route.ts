import { timingSafeEqual } from "node:crypto";
import { ok, unauthenticated, withApiHandler } from "@/lib/api-response";
import { closeExpiredMarkets } from "@/lib/admin";
import { findLedgerMismatches } from "@/lib/credits";
import { pruneRateLimits } from "@/lib/rate-limit";
import { runPendingSettlements } from "@/lib/settlement";

function hasCronSecret(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(req.headers.get("authorization") ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Vercel Cron: closes OPEN markets past their deadline, retries settlements
 * that are pending, failed, or stuck, prunes old rate-limit windows, and
 * checks every balance against the ledger. Requires CRON_SECRET.
 */
export const GET = withApiHandler(async (req) => {
  if (!hasCronSecret(req)) throw unauthenticated("Invalid cron secret");
  const closed = await closeExpiredMarkets();
  const settlements = await runPendingSettlements();
  const prunedRateLimits = await pruneRateLimits();
  const ledgerMismatches = await findLedgerMismatches();
  // Shows up in the Vercel logs. This should never happen; investigate before anything else.
  if (ledgerMismatches.length) console.error("[ledger] balance mismatch", ledgerMismatches);
  return ok({ closed, settlements, prunedRateLimits, ledgerMismatches: ledgerMismatches.length });
});
