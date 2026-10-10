import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CreditTransactionType } from "@/generated/prisma/enums";
import {
  InsufficientCreditsError,
  findLedgerMismatches,
  recordCreditTransaction,
  verifyLedgerIntegrity,
} from "@/lib/credits";
import { db } from "@/lib/db";
import { SIGNUP_GRANT_CREDITS } from "@/lib/types";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const debit = (userId: string, amount: number, key: string) =>
  recordCreditTransaction({
    userId,
    amount: -amount,
    type: CreditTransactionType.ADMIN_ADJUSTMENT,
    idempotencyKey: key,
  });

describe("credit ledger", () => {
  it("finds balances that drifted from the ledger", async () => {
    const good = await makeUser();
    const bad = await makeUser();
    await debit(good.id, 100, "debit-good");
    expect(await findLedgerMismatches()).toEqual([]);

    // Simulate a bug that changed the cached balance without a ledger row.
    await db.user.update({ where: { id: bad.id }, data: { creditBalance: { increment: 5 } } });
    expect(await findLedgerMismatches()).toEqual([
      expect.objectContaining({ userId: bad.id, cachedBalance: SIGNUP_GRANT_CREDITS + 5, ledgerSum: SIGNUP_GRANT_CREDITS }),
    ]);
  });

  it("starts users with the signup grant", async () => {
    const user = await makeUser();
    const report = await verifyLedgerIntegrity(user.id);
    expect(report).toMatchObject({ cachedBalance: SIGNUP_GRANT_CREDITS, ledgerSum: SIGNUP_GRANT_CREDITS, ok: true });
  });

  it("records balanceAfter on each row", async () => {
    const user = await makeUser();
    const { transaction } = await debit(user.id, 250, "debit-0001");
    expect(transaction.balanceAfter).toBe(SIGNUP_GRANT_CREDITS - 250);
  });

  it("refuses to overdraw and writes nothing", async () => {
    const user = await makeUser();
    await expect(debit(user.id, SIGNUP_GRANT_CREDITS + 1, "debit-too-much")).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(await db.creditTransaction.count({ where: { userId: user.id } })).toBe(1);
    expect((await verifyLedgerIntegrity(user.id)).cachedBalance).toBe(SIGNUP_GRANT_CREDITS);
  });

  it("replays a repeated idempotency key instead of applying it twice", async () => {
    const user = await makeUser();
    const first = await debit(user.id, 100, "same-key-0001");
    const second = await debit(user.id, 100, "same-key-0001");
    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect((await verifyLedgerIntegrity(user.id)).cachedBalance).toBe(SIGNUP_GRANT_CREDITS - 100);
  });

  it("rejects an idempotency key reused for a different amount", async () => {
    const user = await makeUser();
    await debit(user.id, 100, "same-key-0002");
    await expect(debit(user.id, 200, "same-key-0002")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never goes negative under concurrent debits", async () => {
    const user = await makeUser();
    const attempts = Array.from({ length: 25 }, (_, i) => debit(user.id, 100, `concurrent-${i}-key`));
    const results = await Promise.allSettled(attempts);

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof InsufficientCreditsError,
    ).length;
    expect(succeeded).toBe(SIGNUP_GRANT_CREDITS / 100);
    expect(failed).toBe(25 - succeeded);

    const report = await verifyLedgerIntegrity(user.id);
    expect(report).toMatchObject({ cachedBalance: 0, brokenLinks: 0, ok: true });
  });

  it("applies a key once even when the same request races itself", async () => {
    const user = await makeUser();
    const results = await Promise.all(Array.from({ length: 10 }, () => debit(user.id, 50, "racing-key-0001")));
    expect(new Set(results.map((r) => r.transaction.id)).size).toBe(1);
    expect(results.filter((r) => !r.replayed).length).toBe(1);
    expect((await verifyLedgerIntegrity(user.id)).cachedBalance).toBe(SIGNUP_GRANT_CREDITS - 50);
  });

  it("blocks edits and deletes of ledger rows at the database level", async () => {
    const user = await makeUser();
    const row = await db.creditTransaction.findFirstOrThrow({ where: { userId: user.id } });
    await expect(db.creditTransaction.update({ where: { id: row.id }, data: { amount: 999999 } })).rejects.toThrow(
      /append-only/,
    );
    await expect(db.creditTransaction.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });

  it("blocks negative balances even for direct writes", async () => {
    const user = await makeUser();
    await expect(db.user.update({ where: { id: user.id }, data: { creditBalance: -1 } })).rejects.toThrow();
  });
});
