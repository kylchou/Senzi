import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MarketStatus, OrgRole, SettlementStatus } from "@/generated/prisma/enums";
import {
  adjustUserCredits,
  changeMarketStatus,
  claimResolutionForSettlement,
  closeExpiredMarkets,
  completeResolutionSettlement,
  resolveMarket,
  setAccountType,
  setPlatformRole,
  updateMarket,
} from "@/lib/admin";
import { db } from "@/lib/db";
import { makeAdmin, makeMarket, makeOrg, makeUser, placeForecast, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const evidence = {
  evidenceSummary: "The company announced the milestone in a press release before the deadline.",
  evidenceUrls: ["https://example.com/press"],
};

describe("market lifecycle", () => {
  it("only lets platform admins manage markets", async () => {
    const admin = await makeAdmin();
    const user = await makeUser();
    const market = await makeMarket(admin);
    await expect(changeMarketStatus(user, market.id, { status: "CLOSED" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("records an opening snapshot with the admin baseline when a market opens", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin, { open: false });
    expect(market.status).toBe(MarketStatus.DRAFT);
    expect(await db.marketSnapshot.count({ where: { marketId: market.id } })).toBe(0);

    await changeMarketStatus(admin, market.id, { status: "OPEN" });
    const snapshot = await db.marketSnapshot.findFirstOrThrow({ where: { marketId: market.id } });
    expect(snapshot).toMatchObject({ sequence: 1, trigger: "OPENING", openingBaseline: 0.4, allocationShare: null });
  });

  it("rejects transitions that skip the resolution workflow", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    await expect(
      changeMarketStatus(admin, market.id, { status: "OPEN" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("lets drafts change freely but locks the terms once the market opens", async () => {
    const admin = await makeAdmin();
    const draft = await makeMarket(admin, { open: false });
    await updateMarket(admin, draft.id, { openingBaseline: 0.6, question: "Will the draft question change?" });

    const open = await makeMarket(admin);
    await expect(updateMarket(admin, open.id, { openingBaseline: 0.7 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await expect(
      updateMarket(admin, open.id, { sources: [{ title: "New source", url: "https://example.com/other", sourceType: "OTHER", license: "LINK_ONLY" }] }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    // Unchanged values and the allowed fields are fine, and logged with before/after values.
    const later = new Date(open.closesAt.getTime() + 24 * 60 * 60 * 1000);
    await updateMarket(admin, open.id, { openingBaseline: 0.4, description: "More context.", closesAt: later });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "market.update", entityId: open.id } });
    expect(audit.data).toMatchObject({
      changes: { description: { from: null, to: "More context." }, closesAt: { from: open.closesAt.toISOString(), to: later.toISOString() } },
    });
  });

  it("requires resolution (not a status change) to cancel a market with forecasts", async () => {
    const admin = await makeAdmin();
    const user = await makeUser();
    const market = await makeMarket(admin);
    await placeForecast(user, market.id);
    await expect(changeMarketStatus(admin, market.id, { status: "CANCELLED" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("closes markets past their deadline", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    expect(await closeExpiredMarkets(new Date(market.closesAt.getTime() + 1))).toBe(1);
    expect((await db.market.findUniqueOrThrow({ where: { id: market.id } })).status).toBe(MarketStatus.CLOSED);
  });
});

describe("resolution", () => {
  it("records evidence, notifies forecasters, audits, and leaves settlement pending", async () => {
    const admin = await makeAdmin();
    const user = await makeUser();
    const market = await makeMarket(admin);
    await placeForecast(user, market.id);

    const resolution = await resolveMarket(admin, market.id, { outcome: "YES", ...evidence });
    expect(resolution.settlementStatus).toBe(SettlementStatus.PENDING);
    expect((await db.market.findUniqueOrThrow({ where: { id: market.id } })).status).toBe(MarketStatus.RESOLVED);
    expect(await db.notification.count({ where: { userId: user.id, type: "MARKET_RESOLVED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "market.resolve", entityId: market.id } })).toBe(1);
  });

  it("can only resolve a market once, even concurrently", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const results = await Promise.allSettled([
      resolveMarket(admin, market.id, { outcome: "YES", ...evidence }),
      resolveMarket(admin, market.id, { outcome: "NO", ...evidence }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.resolution.count({ where: { marketId: market.id } })).toBe(1);
  });

  it("marks VOID outcomes as CANCELLED markets", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    await resolveMarket(admin, market.id, { outcome: "VOID", voidReason: "UNVERIFIABLE", ...evidence });
    expect((await db.market.findUniqueOrThrow({ where: { id: market.id } })).status).toBe(MarketStatus.CANCELLED);
  });

  it("lets exactly one settlement worker claim a resolution", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const resolution = await resolveMarket(admin, market.id, { outcome: "NO", ...evidence });

    const claims = await Promise.all([1, 2, 3].map(() => claimResolutionForSettlement(resolution.id)));
    expect(claims.filter(Boolean)).toHaveLength(1);

    await completeResolutionSettlement(resolution.id);
    expect(await claimResolutionForSettlement(resolution.id)).toBe(false);
  });
});

describe("admin credits and roles", () => {
  it("grants credits idempotently with an audit entry", async () => {
    const admin = await makeAdmin();
    const user = await makeUser();
    const input = { userId: user.id, amount: 500, type: "ADMIN_GRANT" as const, memo: "Hackathon prize", idempotencyKey: "grant-hackathon-1" };

    const first = await adjustUserCredits(admin, input);
    const second = await adjustUserCredits(admin, input);
    expect(second.replayed).toBe(true);
    expect(second.transaction.id).toBe(first.transaction.id);
    expect(await db.auditLog.count({ where: { action: "credits.adjust" } })).toBe(1);
  });

  it("changes account types with a reason, but not while someone is in a VC org", async () => {
    const admin = await makeAdmin();
    const user = await makeUser({ accountType: "VC" });
    const org = await makeOrg([[user, OrgRole.VIEWER]]);
    await expect(setAccountType(admin, user.id, { accountType: "TRADER", reason: "Left the fund" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    await db.organizationMembership.deleteMany({ where: { organizationId: org.id } });
    await setAccountType(admin, user.id, { accountType: "TRADER", reason: "Left the fund" });
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "user.accountType" } });
    expect(log.data).toMatchObject({ from: "VC", to: "TRADER", reason: "Left the fund" });
    await expect(setAccountType(admin, admin.id, { accountType: "VC", reason: "Myself" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("does not let admins change their own role", async () => {
    const admin = await makeAdmin();
    await expect(setPlatformRole(admin, admin.id, "USER")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("requires an organization for non-public markets", async () => {
    const admin = await makeAdmin();
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    const market = await makeMarket(admin, { private: org.id });
    expect(market.organizationId).toBe(org.id);
    await expect(updateMarket(admin, market.id, { organizationId: null })).rejects.toThrow();
  });
});
