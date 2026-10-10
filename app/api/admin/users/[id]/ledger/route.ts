import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { requirePlatformAdmin } from "@/lib/auth";
import { listCreditTransactions, verifyLedgerIntegrity } from "@/lib/credits";
import { paginationSchema } from "@/lib/validation";

/** A user's ledger plus an integrity check (cached balance vs. ledger chain). */
export const GET = withApiHandler(async (req, ctx: RouteContext<"/api/admin/users/[id]/ledger">) => {
  await requirePlatformAdmin();
  const { id } = await ctx.params;
  const { cursor, limit } = parseSearchParams(req, paginationSchema);
  const [integrity, page] = await Promise.all([
    verifyLedgerIntegrity(id),
    listCreditTransactions(id, { cursor, limit }),
  ]);
  return ok({ integrity, transactions: page.items }, { nextCursor: page.nextCursor, limit });
});
