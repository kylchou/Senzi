import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import {
  approveProposal,
  proposeCorrection,
  proposeResolution,
  rejectProposal,
} from "@/lib/resolutions";
import { runPendingSettlements, runSettlement, STALE_SETTLEMENT_MS } from "@/lib/settlement";
import { makeAdmin, makeMarket, makeUser, placeForecast, resetDatabase } from "./helpers";

beforeEach(async () => {
  await resetDatabase();
  // These tests check the real two-admin rule.
  vi.stubEnv("SENZI_ALLOW_SELF_APPROVAL", "false");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());

const evidence = [{ title: "Press release", url: "https://example.com/press", sourceType: "COMPANY_ANNOUNCEMENT" as const, license: "LINK_ONLY" as const }];
const yes = { outcome: "YES" as const, evidenceSummary: "The company announced the milestone before the deadline.", evidence };
const voidCancelled = { outcome: "VOID" as const, voidReason: "CANCELLED" as const, evidenceSummary: "The company was acquired, so the question no longer applies.", evidence };

describe("two-admin resolution", () => {
  it("needs a second admin, then resolves the market and keeps the history", async () => {
    const alice = await makeAdmin();
    const bob = await makeAdmin();
    const market = await makeMarket(alice);

    const proposal = await proposeResolution(alice, market.id, yes);
    // Forecasting stops while the proposal is reviewed.
    expect((await db.market.findUniqueOrThrow({ where: { id: market.id } })).status).toBe("CLOSED");
    await expect(approveProposal(alice, proposal.id)).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { resolution, settlement } = await approveProposal(bob, proposal.id, { note: "Checked the filing" });
    expect(resolution).toMatchObject({ outcome: "YES", resolvedById: alice.id, approvedById: bob.id, currentProposalId: proposal.id });
    // Approval settles right away through the forecasting engine.
    expect(settlement).toMatchObject({ ran: true, status: "COMPLETED" });
    expect((await db.market.findUniqueOrThrow({ where: { id: market.id } })).status).toBe("RESOLVED");

    const stored = await db.resolutionProposal.findUniqueOrThrow({ where: { id: proposal.id }, include: { evidence: true } });
    expect(stored).toMatchObject({ status: "APPROVED", reviewedById: bob.id, reviewNote: "Checked the filing" });
    expect(stored.evidence[0]).toMatchObject({ sourceType: "COMPANY_ANNOUNCEMENT", license: "LINK_ONLY", submittedById: alice.id });
  });

  it("allows only one open proposal per market", async () => {
    const alice = await makeAdmin();
    const market = await makeMarket(alice);
    await proposeResolution(alice, market.id, yes);
    await expect(proposeResolution(alice, market.id, yes)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets a rejected or withdrawn proposal be replaced", async () => {
    const alice = await makeAdmin();
    const bob = await makeAdmin();
    const market = await makeMarket(alice);
    const first = await proposeResolution(alice, market.id, yes);
    await rejectProposal(bob, first.id, "Evidence is a rumor, not an announcement");
    expect((await db.market.findUniqueOrThrow({ where: { id: market.id } })).status).toBe("CLOSED");

    const second = await proposeResolution(alice, market.id, yes);
    await rejectProposal(alice, second.id, "Withdrawing to add a better source");
    expect(await db.auditLog.count({ where: { action: "resolution.withdraw" } })).toBe(1);
    await expect(approveProposal(bob, second.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("approves only once when two admins click at the same time", async () => {
    const alice = await makeAdmin();
    const bob = await makeAdmin();
    const carol = await makeAdmin();
    const market = await makeMarket(alice);
    const proposal = await proposeResolution(alice, market.id, yes);
    const results = await Promise.allSettled([approveProposal(bob, proposal.id), approveProposal(carol, proposal.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.resolution.count({ where: { marketId: market.id } })).toBe(1);
  });

  it("requires a reason for VOID and cancels the market", async () => {
    const alice = await makeAdmin();
    const bob = await makeAdmin();
    const market = await makeMarket(alice);
    await expect(
      db.resolutionProposal.create({
        data: { marketId: market.id, outcome: "VOID", evidenceSummary: "No reason given here.", proposedById: alice.id },
      }),
    ).rejects.toThrow();

    const proposal = await proposeResolution(alice, market.id, voidCancelled);
    const { resolution } = await approveProposal(bob, proposal.id);
    expect(resolution).toMatchObject({ outcome: "VOID", voidReason: "CANCELLED" });
    expect((await db.market.findUniqueOrThrow({ where: { id: market.id } })).status).toBe("CANCELLED");
  });

  it("never lets a proposal or its evidence be rewritten", async () => {
    const alice = await makeAdmin();
    const market = await makeMarket(alice);
    const proposal = await proposeResolution(alice, market.id, yes);
    await expect(db.resolutionProposal.update({ where: { id: proposal.id }, data: { outcome: "NO" } })).rejects.toThrow(/rewritten/);
    await expect(db.resolutionEvidence.updateMany({ where: { proposalId: proposal.id }, data: { url: "https://x.example" } })).rejects.toThrow(/append-only/);
    await expect(db.resolutionProposal.delete({ where: { id: proposal.id } })).rejects.toThrow(/append-only/);
  });
});

describe("corrections", () => {
  async function resolved() {
    const alice = await makeAdmin();
    const bob = await makeAdmin();
    const market = await makeMarket(alice);
    const proposal = await proposeResolution(alice, market.id, yes);
    const { resolution } = await approveProposal(bob, proposal.id);
    return { alice, bob, market, resolution };
  }

  it("can change the outcome before credits settle, with a reason and full history", async () => {
    const { alice, bob, market, resolution } = await resolved();
    // Approval settles straight away; put it back to unsettled (as when settlement failed) to test the correction path.
    await db.resolution.update({ where: { id: resolution.id }, data: { settlementStatus: "PENDING", settledAt: null } });
    const correction = await proposeCorrection(alice, resolution.id, { ...voidCancelled, correctionReason: "The company was acquired before the deadline" });
    const { resolution: corrected } = await approveProposal(bob, correction.id);

    expect(corrected).toMatchObject({ outcome: "VOID", voidReason: "CANCELLED", correctionCount: 1, currentProposalId: correction.id });
    expect((await db.market.findUniqueOrThrow({ where: { id: market.id } })).status).toBe("CANCELLED");
    expect(await db.resolutionProposal.count({ where: { marketId: market.id, status: "APPROVED" } })).toBe(2);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "resolution.correct" } });
    expect(audit.data).toMatchObject({ changes: { outcome: { from: "YES", to: "VOID" } } });
  });

  it("can't change the outcome after credits settle, but can still fix evidence", async () => {
    const { alice, bob, resolution } = await resolved();
    await runSettlement(resolution.id, async () => ({ settlementModelId: "test" }));

    await expect(
      proposeCorrection(alice, resolution.id, { ...voidCancelled, correctionReason: "Should have been void" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    const fix = await proposeCorrection(alice, resolution.id, {
      ...yes,
      evidence: [{ ...evidence[0]!, url: "https://example.com/press-archived" }],
      correctionReason: "The original link went dead",
    });
    const { resolution: fixed } = await approveProposal(bob, fix.id);
    expect(fixed.evidenceUrls).toEqual(["https://example.com/press-archived"]);
    expect(fixed.settlementStatus).toBe("COMPLETED");
  });
});

describe("settlement runs", () => {
  async function approved() {
    const alice = await makeAdmin();
    const bob = await makeAdmin();
    const user = await makeUser();
    const market = await makeMarket(alice);
    await placeForecast(user, market.id);
    const proposal = await proposeResolution(alice, market.id, yes);
    const { resolution } = await approveProposal(bob, proposal.id);
    // Approval already ran the engine's settlement; these tests drive the state machine themselves from PENDING.
    return db.resolution.update({
      where: { id: resolution.id },
      data: { settlementStatus: "PENDING", settlementAttempts: 0, settlementError: null, settledAt: null, settlementModelId: null, settlementStartedAt: null },
    });
  }

  it("stays PENDING until the forecasting engine is configured", async () => {
    const resolution = await approved();
    expect(await runSettlement(resolution.id, null)).toMatchObject({ ran: false, status: "PENDING" });
  });

  it("records failures and succeeds on retry", async () => {
    const resolution = await approved();
    const failing = await runSettlement(resolution.id, async () => {
      throw new Error("ledger timeout");
    });
    expect(failing).toMatchObject({ ran: true, status: "FAILED", error: "ledger timeout" });

    const retry = await runPendingSettlements(async () => ({ settlementModelId: "pari-mutuel-v1" }));
    expect(retry).toEqual([expect.objectContaining({ status: "COMPLETED" })]);
    expect(await db.resolution.findUniqueOrThrow({ where: { id: resolution.id } })).toMatchObject({
      settlementStatus: "COMPLETED",
      settlementModelId: "pari-mutuel-v1",
      settlementAttempts: 2,
      settlementError: null,
    });
  });

  it("settles once even when triggered concurrently", async () => {
    const resolution = await approved();
    const settle = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await Promise.all([1, 2, 3].map(() => runSettlement(resolution.id, settle)));
    expect(settle).toHaveBeenCalledTimes(1);
  });

  it("picks up attempts that got stuck", async () => {
    const resolution = await approved();
    await db.resolution.update({
      where: { id: resolution.id },
      data: { settlementStatus: "IN_PROGRESS", settlementStartedAt: new Date(Date.now() - STALE_SETTLEMENT_MS - 1000) },
    });
    expect(await runSettlement(resolution.id, async () => {})).toMatchObject({ ran: true, status: "COMPLETED" });
  });
});
