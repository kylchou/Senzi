import type { CreditTransaction } from "@/generated/prisma/client";
import { CreditTransactionType } from "@/generated/prisma/enums";
import { ApiError, conflict, notFound } from "@/lib/api-response";
import { db, isUniqueViolation, type TxClient } from "@/lib/db";
import {
  MAX_CREDIT_TRANSACTION,
  SIGNUP_GRANT_CREDITS,
  type CreditMutationInput,
  type CreditTransactionDTO,
} from "@/lib/types";

/**
 * Authoritative virtual-credit ledger.
 *
 * Invariants (also enforced by the database):
 * - User.creditBalance never goes below zero (CHECK constraint).
 * - Every balance change writes exactly one CreditTransaction row in the same
 *   database transaction; rows are append-only (trigger).
 * - Each logical operation has a globally unique idempotency key, so retries
 *   never double-credit or double-debit.
 *
 * Credits are virtual and have no cash value. There are no deposits,
 * withdrawals, or cash payouts.
 */

export interface AppliedCreditTransaction {
  transaction: CreditTransaction;
  /** True when the idempotency key had already been applied (no new write). */
  replayed: boolean;
}

export class InsufficientCreditsError extends ApiError {
  constructor(readonly balance: number, readonly requested: number) {
    super("INSUFFICIENT_CREDITS", `Insufficient credits: balance ${balance}, needs ${requested}`, {
      balance,
      requested,
    });
  }
}

function assertValidAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new ApiError("VALIDATION_ERROR", "Credit amount must be a non-zero whole number");
  }
  if (Math.abs(amount) > MAX_CREDIT_TRANSACTION) {
    throw new ApiError("VALIDATION_ERROR", `Credit amount exceeds ${MAX_CREDIT_TRANSACTION}`);
  }
}

function assertSameOperation(existing: CreditTransaction, input: CreditMutationInput) {
  if (
    existing.userId !== input.userId ||
    existing.amount !== input.amount ||
    existing.type !== input.type
  ) {
    throw conflict("Idempotency key was already used for a different credit operation");
  }
}

/**
 * Applies one ledger entry inside the caller's transaction. Use this when the
 * credit change must commit atomically with other writes (e.g. creating a
 * Forecast, settling a market).
 *
 * Concurrency: the balance update is a single conditional
 * `UPDATE ... WHERE creditBalance + amount >= 0`, which takes a row lock, so
 * concurrent debits serialize and can never overdraw. If a concurrent
 * transaction commits the same idempotency key first, the ledger insert fails
 * with a unique violation and the caller's whole transaction rolls back;
 * recordCreditTransaction() handles that retry for standalone writes.
 */
export async function applyCreditTransaction(
  tx: TxClient,
  input: CreditMutationInput,
): Promise<AppliedCreditTransaction> {
  assertValidAmount(input.amount);

  const existing = await tx.creditTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    assertSameOperation(existing, input);
    return { transaction: existing, replayed: true };
  }

  const updated = await tx.$queryRaw<{ creditBalance: number }[]>`
    UPDATE "User"
    SET "creditBalance" = "creditBalance" + ${input.amount}, "updatedAt" = now()
    WHERE "id" = ${input.userId} AND "creditBalance" + ${input.amount} >= 0
    RETURNING "creditBalance"`;

  if (updated.length === 0) {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { creditBalance: true },
    });
    if (!user) throw notFound("User");
    throw new InsufficientCreditsError(user.creditBalance, -input.amount);
  }

  const transaction = await tx.creditTransaction.create({
    data: {
      userId: input.userId,
      amount: input.amount,
      balanceAfter: updated[0]!.creditBalance,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      marketId: input.marketId ?? null,
      forecastId: input.forecastId ?? null,
      resolutionId: input.resolutionId ?? null,
      actorId: input.actorId ?? null,
      memo: input.memo ?? null,
    },
  });
  return { transaction, replayed: false };
}

/**
 * Applies one ledger entry in its own database transaction. Safe to retry
 * with the same idempotency key, including concurrently.
 */
export async function recordCreditTransaction(
  input: CreditMutationInput,
): Promise<AppliedCreditTransaction> {
  try {
    return await db.$transaction((tx) => applyCreditTransaction(tx, input));
  } catch (error) {
    if (isUniqueViolation(error, "idempotencyKey")) {
      const existing = await db.creditTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        assertSameOperation(existing, input);
        return { transaction: existing, replayed: true };
      }
    }
    throw error;
  }
}

/** One-time welcome grant. Idempotent per user. */
export function grantSignupCredits(tx: TxClient, userId: string) {
  return applyCreditTransaction(tx, {
    userId,
    amount: SIGNUP_GRANT_CREDITS,
    type: CreditTransactionType.SIGNUP_GRANT,
    idempotencyKey: `signup:${userId}`,
    memo: "Welcome grant (virtual credits, no cash value)",
  });
}

export async function getCreditBalance(userId: string): Promise<number> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { creditBalance: true } });
  if (!user) throw notFound("User");
  return user.creditBalance;
}

export function toCreditTransactionDTO(row: CreditTransaction): CreditTransactionDTO {
  return {
    id: row.id,
    amount: row.amount,
    balanceAfter: row.balanceAfter,
    type: row.type,
    marketId: row.marketId,
    forecastId: row.forecastId,
    resolutionId: row.resolutionId,
    memo: row.memo,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Newest-first page of a user's ledger. */
export async function listCreditTransactions(
  userId: string,
  { cursor, limit }: { cursor?: string; limit: number },
) {
  const rows = await db.creditTransaction.findMany({
    where: { userId },
    orderBy: { sequence: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toCreditTransactionDTO),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export interface LedgerIntegrityReport {
  userId: string;
  cachedBalance: number;
  ledgerSum: number;
  latestBalanceAfter: number | null;
  /** Rows whose balanceAfter != previous balanceAfter + amount. */
  brokenLinks: number;
  ok: boolean;
}

/**
 * Recomputes a user's balance from the ledger and checks every row chains
 * from the previous one. Used by admin tools and tests.
 */
export async function verifyLedgerIntegrity(userId: string): Promise<LedgerIntegrityReport> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { creditBalance: true } });
  if (!user) throw notFound("User");

  const [stats] = await db.$queryRaw<
    { ledgerSum: bigint | null; latestBalanceAfter: number | null; brokenLinks: bigint }[]
  >`
    SELECT
      sum("amount") AS "ledgerSum",
      (array_agg("balanceAfter" ORDER BY "sequence" DESC))[1] AS "latestBalanceAfter",
      count(*) FILTER (WHERE "balanceAfter" <> "previous" + "amount") AS "brokenLinks"
    FROM (
      SELECT "amount", "balanceAfter", "sequence",
             lag("balanceAfter", 1, 0) OVER (ORDER BY "sequence") AS "previous"
      FROM "CreditTransaction"
      WHERE "userId" = ${userId}
    ) AS chain`;

  const ledgerSum = Number(stats?.ledgerSum ?? 0);
  const latestBalanceAfter = stats?.latestBalanceAfter ?? null;
  const brokenLinks = Number(stats?.brokenLinks ?? 0);
  return {
    userId,
    cachedBalance: user.creditBalance,
    ledgerSum,
    latestBalanceAfter,
    brokenLinks,
    ok:
      brokenLinks === 0 &&
      ledgerSum === user.creditBalance &&
      (latestBalanceAfter ?? 0) === user.creditBalance,
  };
}

/**
 * Every user whose cached balance doesn't match their ledger, or whose ledger
 * rows don't chain. Run by the cron job; should always come back empty.
 */
export async function findLedgerMismatches(limit = 50): Promise<LedgerIntegrityReport[]> {
  const rows = await db.$queryRaw<
    { userId: string; cachedBalance: number; ledgerSum: bigint; latestBalanceAfter: number | null; brokenLinks: bigint }[]
  >`
    WITH chain AS (
      SELECT "userId", "amount", "balanceAfter", "sequence",
             lag("balanceAfter", 1, 0) OVER (PARTITION BY "userId" ORDER BY "sequence") AS "previous"
      FROM "CreditTransaction"
    ), per_user AS (
      SELECT "userId",
             sum("amount") AS "ledgerSum",
             (array_agg("balanceAfter" ORDER BY "sequence" DESC))[1] AS "latestBalanceAfter",
             count(*) FILTER (WHERE "balanceAfter" <> "previous" + "amount") AS "brokenLinks"
      FROM chain
      GROUP BY "userId"
    )
    SELECT u."id" AS "userId", u."creditBalance" AS "cachedBalance",
           coalesce(p."ledgerSum", 0) AS "ledgerSum", p."latestBalanceAfter",
           coalesce(p."brokenLinks", 0) AS "brokenLinks"
    FROM "User" u
    LEFT JOIN per_user p ON p."userId" = u."id"
    WHERE coalesce(p."brokenLinks", 0) > 0
       OR coalesce(p."ledgerSum", 0) <> u."creditBalance"
       OR coalesce(p."latestBalanceAfter", 0) <> u."creditBalance"
    ORDER BY u."id"
    LIMIT ${limit}`;

  return rows.map((r) => ({
    userId: r.userId,
    cachedBalance: r.cachedBalance,
    ledgerSum: Number(r.ledgerSum),
    latestBalanceAfter: r.latestBalanceAfter,
    brokenLinks: Number(r.brokenLinks),
    ok: false,
  }));
}
