/**
 * End-to-end credit flows through the real engine, ledger and settlement:
 * many traders on both sides, settlement payouts ("cashing out" at
 * resolution), VOID refunds, retries after a failed settlement, prize pools,
 * verified-users-only markets, and closed markets.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-response";
import { verifyLedgerIntegrity } from "@/lib/credits";
import { db } from "@/lib/db";
import { worstCaseLoss } from "@/lib/forecasting/lmsr";
import { portfolioForUser, submitForecastForUser } from "@/lib/forecasting/server/api";
import { forecastingSettle } from "@/lib/forecasting/server/settle";
import { runSettlement as runKySettlement } from "@/lib/settlement";
import { SIGNUP_GRANT_CREDITS } from "@/lib/types";
import { splitPrizePool } from "@/lib/vc/prize-pool";
import { getVcServices } from "@/lib/vc/server/container";
import { makeAdmin, makeMarket, makeOrg, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const settle = (resolutionId: string) => runKySettlement(resolutionId, forecastingSettle);
type User = Awaited<ReturnType<typeof makeUser>>;

let keyN = 0;
const submit = (user: User, marketId: string, side: "YES" | "NO", credits: number) =>
  submitForecastForUser(user, { marketId, side, credits, idempotencyKey: `e2e-${++keyN}` });

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof ApiError && e.code === code);
}

const balance = async (u: { id: string }) => (await db.user.findUniqueOrThrow({ where: { id: u.id } })).creditBalance;

async function resolve(marketId: string, outcome: "YES" | "NO" | "VOID") {
  await db.market.update({ where: { id: marketId }, data: { status: "CLOSED" } });
  const r = await db.resolution.create({
    data: {
      marketId,
      outcome,
      ...(outcome === "VOID" ? { voidReason: "INVALID_MARKET" as const } : {}),
      evidenceSummary: "End-to-end test outcome",
      evidenceUrls: ["https://example.com/evidence"],
    },
  });
  return r.id;
}

async function everyLedgerConsistent() {
  for (const u of await db.user.findMany({ select: { id: true } })) {
    const report = await verifyLedgerIntegrity(u.id);
    expect(report.ok, JSON.stringify(report)).toBe(true);
  }
}

/** Six trades across four traders, both sides, including repeat buys. */
async function tradeAMarket() {
  const admin = await makeAdmin();
  const market = await makeMarket(admin);
  const traders = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
  const [t1, t2, t3, t4] = traders as [User, User, User, User];
  const plan: [User, "YES" | "NO", number][] = [
    [t1, "YES", 200],
    [t2, "NO", 150],
    [t3, "YES", 50],
    [t1, "YES", 100],
    [t4, "NO", 300],
    [t2, "NO", 50],
  ];
  const receipts = [];
  for (const [user, side, credits] of plan) receipts.push({ user, side, credits, r: await submit(user, market.id, side, credits) });
  return { admin, market, traders, receipts };
}

describe("credits through a full market", () => {
  it("moves the price with each trade and debits exactly what was staked", async () => {
    const { traders, receipts } = await tradeAMarket();
    for (const { side, r } of receipts) {
      // Buying YES raises the YES price; buying NO lowers it.
      if (side === "YES") expect(r.priceAfter!).toBeGreaterThan(r.priceBefore!);
      else expect(r.priceAfter!).toBeLessThan(r.priceBefore!);
      expect(r.shares!).toBeGreaterThan(0);
    }
    for (const t of traders) {
      const staked = receipts.filter((x) => x.user.id === t.id).reduce((s, x) => s + x.credits, 0);
      expect(await balance(t)).toBe(SIGNUP_GRANT_CREDITS - staked);
    }
    await everyLedgerConsistent();
  });

  it("refuses a stake bigger than the balance and leaves it untouched", async () => {
    const { market, traders } = await tradeAMarket();
    const t3 = traders[2]!;
    const before = await balance(t3);
    await expectCode(submit(t3, market.id, "YES", before + 1), "INSUFFICIENT_CREDITS");
    expect(await balance(t3)).toBe(before);
    // Spending exactly the whole balance works, down to zero.
    await submit(t3, market.id, "YES", before);
    expect(await balance(t3)).toBe(0);
    await expectCode(submit(t3, market.id, "NO", 1), "INSUFFICIENT_CREDITS");
    await everyLedgerConsistent();
  });

  it("pays every winning forecast its whole shares on YES, nothing to losers, once", async () => {
    const { market, traders, receipts } = await tradeAMarket();
    const run = await settle(await resolve(market.id, "YES"));
    expect(run).toMatchObject({ status: "COMPLETED", ran: true });

    for (const t of traders) {
      const mine = receipts.filter((x) => x.user.id === t.id);
      const staked = mine.reduce((s, x) => s + x.credits, 0);
      const paid = mine.filter((x) => x.side === "YES").reduce((s, x) => s + Math.floor(x.r.shares!), 0);
      expect(await balance(t)).toBe(SIGNUP_GRANT_CREDITS - staked + paid);
    }
    const forecasts = await db.forecast.findMany({ where: { marketId: market.id } });
    expect(forecasts.every((f) => f.status === "SETTLED")).toBe(true);

    // The platform's subsidy (payouts beyond stakes) is bounded by the LMSR worst case.
    const totalStaked = receipts.reduce((s, x) => s + x.credits, 0);
    const totalPaid = forecasts.reduce((s, f) => s + (f.payout ?? 0), 0);
    expect(totalPaid - totalStaked).toBeLessThanOrEqual(worstCaseLoss(0.4, 1700));

    // Settling again pays nobody twice.
    const payoutsBefore = await db.creditTransaction.count({ where: { type: "SETTLEMENT_PAYOUT" } });
    expect((await settle((await db.resolution.findUniqueOrThrow({ where: { marketId: market.id } })).id)).ran).toBe(false);
    expect(await db.creditTransaction.count({ where: { type: "SETTLEMENT_PAYOUT" } })).toBe(payoutsBefore);
    await everyLedgerConsistent();
  });

  it("pays the NO side when the market resolves NO", async () => {
    const { market, traders, receipts } = await tradeAMarket();
    await settle(await resolve(market.id, "NO"));
    for (const t of traders) {
      const mine = receipts.filter((x) => x.user.id === t.id);
      const staked = mine.reduce((s, x) => s + x.credits, 0);
      const paid = mine.filter((x) => x.side === "NO").reduce((s, x) => s + Math.floor(x.r.shares!), 0);
      expect(await balance(t)).toBe(SIGNUP_GRANT_CREDITS - staked + paid);
    }
    await everyLedgerConsistent();
  });

  it("refunds every stake exactly on VOID, including repeat buys", async () => {
    const { market, traders } = await tradeAMarket();
    await settle(await resolve(market.id, "VOID"));
    for (const t of traders) expect(await balance(t)).toBe(SIGNUP_GRANT_CREDITS);
    expect((await db.forecast.findMany({ where: { marketId: market.id } })).every((f) => f.status === "REFUNDED")).toBe(true);
    await everyLedgerConsistent();
  });

  it("pays nothing when settlement fails, then pays exactly once on retry", async () => {
    const { market, traders, receipts } = await tradeAMarket();
    const resolutionId = await resolve(market.id, "YES");
    const failed = await runKySettlement(resolutionId, async () => {
      throw new Error("simulated crash");
    });
    expect(failed.status).toBe("FAILED");
    expect(await db.creditTransaction.count({ where: { type: "SETTLEMENT_PAYOUT" } })).toBe(0);

    expect((await settle(resolutionId)).status).toBe("COMPLETED");
    const t1 = traders[0]!;
    const paid = receipts.filter((x) => x.user.id === t1.id && x.side === "YES").reduce((s, x) => s + Math.floor(x.r.shares!), 0);
    expect(await balance(t1)).toBe(SIGNUP_GRANT_CREDITS - 300 + paid);
    await everyLedgerConsistent();
  });

  it("shows the result in each trader's portfolio", async () => {
    const { market, traders, receipts } = await tradeAMarket();
    await settle(await resolve(market.id, "YES"));
    const t1 = traders[0]!;
    // One row per forecast: trader 1 bought YES twice and won both; trader 4's NO lost.
    const p = await portfolioForUser(t1);
    expect(p.resolved).toHaveLength(receipts.filter((x) => x.user.id === t1.id).length);
    expect(p.resolved.every((r) => r.result === "won")).toBe(true);
    const t4 = traders[3]!;
    expect((await portfolioForUser(t4)).resolved.map((r) => r.result)).toEqual(["lost"]);
  });

  it("refuses trades once the market is closed or resolved", async () => {
    const { market, traders } = await tradeAMarket();
    await db.market.update({ where: { id: market.id }, data: { status: "CLOSED" } });
    await expectCode(submit(traders[0]!, market.id, "YES", 10), "INVALID_STATE");
    await settle(await resolve(market.id, "YES"));
    await expectCode(submit(traders[0]!, market.id, "YES", 10), "INVALID_STATE");
  });
});

describe("prize pool on top of a real settlement", () => {
  it("splits the pool by each trader's net gain after settlement", async () => {
    const { market, traders, receipts } = await tradeAMarket();
    const owner = await makeUser();
    const org = await makeOrg([[owner, "OWNER"]]);
    const study = await db.researchStudy.create({
      data: {
        organizationId: org.id,
        createdById: owner.id,
        startupId: market.startupId,
        marketId: market.id,
        question: market.question,
        yesCriteria: market.yesCriteria,
        noCriteria: market.noCriteria,
        deadline: market.closesAt,
        status: "RESOLVED",
        resolvedOutcome: "YES",
        resolvedAt: new Date(),
        prizePoolCredits: 1000,
      },
    });
    await settle(await resolve(market.id, "YES"));
    const balancesAfterSettlement = new Map(await Promise.all(traders.map(async (t) => [t.id, await balance(t)] as const)));

    expect(await getVcServices().studies.payPrizePools()).toMatchObject({ paid: 1, failed: 0 });

    const gains = traders.map((t) => {
      const mine = receipts.filter((x) => x.user.id === t.id);
      const staked = mine.reduce((s, x) => s + x.credits, 0);
      const paid = mine.filter((x) => x.side === "YES").reduce((s, x) => s + Math.floor(x.r.shares!), 0);
      return { userId: t.id, gain: paid - staked };
    });
    const expected = new Map(splitPrizePool(1000, gains).map((s) => [s.userId, s.amount]));
    for (const t of traders) {
      expect(await balance(t)).toBe(balancesAfterSettlement.get(t.id)! + (expected.get(t.id) ?? 0));
    }
    expect([...expected.values()].reduce((s, n) => s + n, 0)).toBe(1000);
    expect((await db.researchStudy.findUniqueOrThrow({ where: { id: study.id } })).prizeDistributedAt).not.toBeNull();

    // Paid once.
    expect(await getVcServices().studies.payPrizePools()).toMatchObject({ paid: 0 });
    expect(await db.creditTransaction.count({ where: { type: "PRIZE_POOL_PAYOUT" } })).toBe(expected.size);
    await everyLedgerConsistent();
  });
});

describe("verified-users-only markets", () => {
  it("lets only verified users of the product trade", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin, { verifiedUsersOnly: true });
    const [verified, outsider] = [await makeUser(), await makeUser()];
    await db.productUserVerification.create({
      data: { userId: verified.id, startupId: market.startupId, method: "SCREENSHOT", status: "APPROVED", reviewedAt: new Date() },
    });
    await expectCode(submit(outsider, market.id, "YES", 50), "FORBIDDEN");
    expect(await balance(outsider)).toBe(SIGNUP_GRANT_CREDITS);
    const r = await submit(verified, market.id, "YES", 50);
    expect(r.balanceAfter).toBe(SIGNUP_GRANT_CREDITS - 50);
    // Verified users' trades count toward the specialized line.
    const f = await db.forecast.findUniqueOrThrow({ where: { id: r.id } });
    expect(f.verifiedAtEntry).toBe(true);
    await everyLedgerConsistent();
  });
});
