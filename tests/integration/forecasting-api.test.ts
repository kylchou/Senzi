import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OrgRole } from "@/generated/prisma/enums";
import { ApiError } from "@/lib/api-response";
import { verifyLedgerIntegrity } from "@/lib/credits";
import { db } from "@/lib/db";
import { worstCaseLoss } from "@/lib/forecasting/lmsr";
import { leaderboard, portfolioForUser, quoteForUser, submitForecastForUser } from "@/lib/forecasting/server/api";
import { forecastingSettle } from "@/lib/forecasting/server/settle";
import { runSettlement as runKySettlement } from "@/lib/settlement";

/** Ky's state machine with our settle function (his module isn't switched on yet). */
const runSettlement = (resolutionId: string) => runKySettlement(resolutionId, forecastingSettle);
import { SIGNUP_GRANT_CREDITS } from "@/lib/types";
import { makeAdmin, makeMarket, makeOrg, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

let keyN = 0;
const submit = (user: Awaited<ReturnType<typeof makeUser>>, marketId: string, side: "YES" | "NO", credits: number, extra: { idempotencyKey?: string; quotedPrice?: number } = {}) =>
  submitForecastForUser(user, { marketId, side, credits, idempotencyKey: extra.idempotencyKey ?? `k-${++keyN}`, ...(extra.quotedPrice !== undefined ? { quotedPrice: extra.quotedPrice } : {}) });

async function expectApiError(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe(code);
    return e as ApiError;
  }
  throw new Error(`expected ${code}`);
}

/** Every user's cached balance matches their ledger, with no broken links. */
async function ledgerIsConsistent() {
  const users = await db.user.findMany({ select: { id: true } });
  for (const u of users) expect((await verifyLedgerIntegrity(u.id)).ok).toBe(true);
}

async function resolve(marketId: string, outcome: "YES" | "NO" | "VOID") {
  await db.market.update({ where: { id: marketId }, data: { status: "CLOSED" } });
  const r = await db.resolution.create({
    data: {
      marketId,
      outcome,
      ...(outcome === "VOID" ? { voidReason: "INVALID_MARKET" as const } : {}),
      evidenceSummary: "Integration test outcome",
      evidenceUrls: ["https://example.com/evidence"],
    },
  });
  return r.id;
}

describe("POST /api/forecasts (LMSR, database)", () => {
  it("places a trade at the LMSR price, debits the ledger and records the market history", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const alice = await makeUser();

    const r = await submit(alice, market.id, "YES", 100);
    expect(r).toMatchObject({ marketId: market.id, side: "YES", credits: 100, balanceAfter: SIGNUP_GRANT_CREDITS - 100, sequence: 1, replayed: false });
    expect(r.priceBefore).toBeCloseTo(0.4, 9);
    expect(r.priceAfter!).toBeGreaterThan(0.4);
    expect(r.shares!).toBeGreaterThan(100);

    const row = await db.market.findUniqueOrThrow({ where: { id: market.id } });
    expect(row).toMatchObject({ yesCredits: 100, noCredits: 0, forecastCount: 1 });
    const f = await db.forecast.findUniqueOrThrow({ where: { id: r.id } });
    expect((f.fill as { b: number }).b).toBe(1700);
    const snap = await db.marketSnapshot.findFirstOrThrow({ where: { marketId: market.id, trigger: "FORECAST" } });
    expect(snap).toMatchObject({ estimateRuleId: "lmsr-v1", estimateKind: "MARKET_PRICE", forecastId: r.id, allocationShare: 1 });
    expect(snap.generalEstimate).toBeCloseTo(r.priceAfter!, 12);
    expect(snap.sequence).toBeGreaterThan(1); // after Ky's OPENING snapshot

    const tx = await db.creditTransaction.findFirstOrThrow({ where: { userId: alice.id, type: "FORECAST_STAKE" } });
    expect(tx).toMatchObject({ amount: -100, idempotencyKey: `forecast:${r.id}` });
    await ledgerIsConsistent();
  });

  it("returns the original receipt for a retried request", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const alice = await makeUser();
    const a = await submit(alice, market.id, "NO", 50, { idempotencyKey: "same" });
    const b = await submit(alice, market.id, "NO", 50, { idempotencyKey: "same" });
    expect(b.replayed).toBe(true);
    expect(b.id).toBe(a.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: alice.id } })).creditBalance).toBe(SIGNUP_GRANT_CREDITS - 50);
    await expectApiError(submit(alice, market.id, "YES", 50, { idempotencyKey: "same" }), "CONFLICT");
  });

  it("serializes simultaneous trades on one market", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const users = await Promise.all(Array.from({ length: 8 }, () => makeUser()));
    const receipts = await Promise.all(users.map((u, i) => submit(u, market.id, i % 2 ? "NO" : "YES", 100)));
    const ordered = [...receipts].sort((a, b) => a.sequence - b.sequence);
    expect(ordered.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i < ordered.length; i++) expect(ordered[i]!.priceBefore).toBeCloseTo(ordered[i - 1]!.priceAfter!, 12);
    await ledgerIsConsistent();
  });

  it("rejects bad requests with the shared error codes", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const poor = await makeUser({ credits: false });
    await expectApiError(submit(poor, market.id, "YES", 10), "INSUFFICIENT_CREDITS");

    const rich = await makeUser();
    const moved = await expectApiError(submit(rich, market.id, "YES", 10, { quotedPrice: 0.6 }), "CONFLICT");
    expect((moved.details as { reason: string }).reason).toBe("PRICE_MOVED");
    expect((moved.details as { quote: { shares: number } }).quote.shares).toBeGreaterThan(0);

    await expectApiError(submit(rich, "no-such-market", "YES", 10), "NOT_FOUND");
    const closed = await makeMarket(admin, { open: false });
    await expectApiError(submit(rich, closed.id, "YES", 10), "NOT_FOUND"); // drafts aren't visible
  });

  it("bars the sponsoring organization and hides private markets from outsiders", async () => {
    const admin = await makeAdmin();
    const vc = await makeUser();
    const org = await makeOrg([[vc, OrgRole.ANALYST]]);
    const market = await makeMarket(admin, { private: org.id });
    await expectApiError(submit(vc, market.id, "YES", 10), "FORBIDDEN");
    const outsider = await makeUser();
    await expectApiError(submit(outsider, market.id, "YES", 10), "NOT_FOUND");
  });

  it("quotes without writing anything", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const q = await quoteForUser(null, { marketId: market.id, side: "YES", credits: 100 });
    expect(q.priceBefore).toBeCloseTo(0.4, 9);
    expect(q.priceAfter!).toBeGreaterThan(0.4);
    expect(q.label).toBe("Market probability (all users)");
    expect(await db.forecast.count()).toBe(0);
  });
});

describe("settlement through Ky's state machine", () => {
  it("pays 1 credit per winning share, once, and records it", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const [yes, no] = [await makeUser(), await makeUser()];
    const y = await submit(yes, market.id, "YES", 300);
    await submit(no, market.id, "NO", 200);

    const resolutionId = await resolve(market.id, "YES");
    const run = await runSettlement(resolutionId);
    expect(run).toMatchObject({ status: "COMPLETED", ran: true });

    const payout = Math.floor(y.shares!);
    expect((await db.user.findUniqueOrThrow({ where: { id: yes.id } })).creditBalance).toBe(SIGNUP_GRANT_CREDITS - 300 + payout);
    expect((await db.user.findUniqueOrThrow({ where: { id: no.id } })).creditBalance).toBe(SIGNUP_GRANT_CREDITS - 200);
    const forecasts = await db.forecast.findMany({ where: { marketId: market.id }, orderBy: { sequence: "asc" } });
    expect(forecasts.map((f) => [f.status, f.payout])).toEqual([["SETTLED", payout], ["SETTLED", 0]]);
    const resolution = await db.resolution.findUniqueOrThrow({ where: { id: resolutionId } });
    expect(resolution).toMatchObject({ settlementStatus: "COMPLETED", settlementModelId: "lmsr-v1-shares" });
    // The platform-funded subsidy is bounded by the LMSR worst case.
    expect(payout - 500).toBeLessThanOrEqual(worstCaseLoss(0.4, 1700));

    // A second run does nothing.
    expect((await runSettlement(resolutionId)).ran).toBe(false);
    expect(await db.creditTransaction.count({ where: { type: "SETTLEMENT_PAYOUT" } })).toBe(1);
    await ledgerIsConsistent();
  });

  it("refunds exactly what was spent on VOID", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const [a, b] = [await makeUser(), await makeUser()];
    await submit(a, market.id, "YES", 120);
    await submit(b, market.id, "NO", 80);
    const run = await runSettlement(await resolve(market.id, "VOID"));
    expect(run.status).toBe("COMPLETED");
    for (const u of [a, b]) expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).creditBalance).toBe(SIGNUP_GRANT_CREDITS);
    expect((await db.forecast.findMany({ where: { marketId: market.id } })).every((f) => f.status === "REFUNDED")).toBe(true);
    await ledgerIsConsistent();
  });

  it("serves the portfolio and leaderboard from the database", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const alice = await makeUser();
    await submit(alice, market.id, "YES", 100);
    await runSettlement(await resolve(market.id, "YES"));
    const p = await portfolioForUser(alice);
    expect(p.resolved).toHaveLength(1);
    expect(p.resolved[0]!.result).toBe("won");
    const lb = await leaderboard({ metric: "net_result", limit: 10 });
    expect(lb.entries[0]).toMatchObject({ userId: alice.id, rank: 1 });
  });
});
