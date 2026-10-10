import { ok, parseSearchParams, withApiHandler } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { getCreditBalance, listCreditTransactions } from "@/lib/credits";
import { paginationSchema } from "@/lib/validation";

/** Current balance plus a newest-first page of the caller's credit ledger. */
export const GET = withApiHandler(async (req) => {
  const user = await requireUser();
  const { cursor, limit } = parseSearchParams(req, paginationSchema);
  const [balance, page] = await Promise.all([
    getCreditBalance(user.id),
    listCreditTransactions(user.id, { cursor, limit }),
  ]);
  return ok({ balance, transactions: page.items }, { nextCursor: page.nextCursor, limit });
});
