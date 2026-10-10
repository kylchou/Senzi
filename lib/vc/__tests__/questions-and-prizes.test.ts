import { describe, expect, it } from "vitest";
import { FileModelStore } from "@/lib/model";
import { VcError } from "../errors";
import { estimateWithModel, modelMetricsFor } from "../model-estimate";
import { splitPrizePool } from "../prize-pool";
import { createStudyInput } from "../validation";
import { openStudy, setup, users, validStudyInput } from "./fixtures";

const code = (c: VcError["code"], message?: RegExp) => (e: unknown) =>
  e instanceof VcError && e.code === c && (!message || message.test(e.message));

describe("prize pool split", () => {
  it("splits by gain, pays whole credits, and pays the whole pool", () => {
    const shares = splitPrizePool(1000, [
      { userId: "a", gain: 300 },
      { userId: "b", gain: 100 },
      { userId: "c", gain: -50 },
      { userId: "d", gain: 0 },
    ]);
    expect(shares).toEqual([
      { userId: "a", amount: 750 },
      { userId: "b", amount: 250 },
    ]);
  });

  it("gives rounding leftovers to the largest remainders, ties by user id", () => {
    const shares = splitPrizePool(100, [
      { userId: "b", gain: 1 },
      { userId: "a", gain: 1 },
      { userId: "c", gain: 1 },
    ]);
    expect(shares).toEqual([
      { userId: "b", amount: 33 },
      { userId: "a", amount: 34 },
      { userId: "c", amount: 33 },
    ]);
    expect(shares.reduce((s, x) => s + x.amount, 0)).toBe(100);
  });

  it("pays nothing without a pool or without anyone who gained", () => {
    expect(splitPrizePool(0, [{ userId: "a", gain: 10 }])).toEqual([]);
    expect(splitPrizePool(500, [{ userId: "a", gain: -10 }])).toEqual([]);
  });
});

describe("who can trade", () => {
  it("defaults to public, and validates at least one audience and the prize range", () => {
    const parsed = createStudyInput.parse(validStudyInput());
    expect(parsed).toMatchObject({ openToPublic: true, openToVerified: false, prizePoolCredits: 0 });
    expect(createStudyInput.safeParse({ ...validStudyInput(), openToPublic: false, openToVerified: false }).success).toBe(false);
    expect(createStudyInput.safeParse({ ...validStudyInput(), prizePoolCredits: 1.5 }).success).toBe(false);
    expect(createStudyInput.safeParse({ ...validStudyInput(), prizePoolCredits: -1 }).success).toBe(false);
  });

  it("makes public questions public research, and keeps verified-only ones with the firm", async () => {
    const s = setup();
    const both = await s.services.studies.create(users.analystA, { ...validStudyInput({ visibility: undefined }), openToVerified: true, prizePoolCredits: 500 });
    expect(both).toMatchObject({ visibility: "PUBLIC", openToPublic: true, openToVerified: true, prizePoolCredits: 500 });
    const verifiedOnly = await s.services.studies.create(users.analystA, { ...validStudyInput({ visibility: undefined }), openToPublic: false, openToVerified: true });
    expect(verifiedOnly).toMatchObject({ visibility: "ORGANIZATION", openToPublic: false });
    await expect(
      s.services.studies.update(users.analystA, verifiedOnly.id, { openToVerified: false, expectedVersion: 1 }),
    ).rejects.toSatisfy(code("VALIDATION_ERROR"));
    const opened = await s.services.studies.update(users.analystA, verifiedOnly.id, { openToPublic: true, expectedVersion: 1 });
    expect(opened.visibility).toBe("PUBLIC");
  });

  it("opens a verified-users-only question as a public market only verified users can trade", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, { ...validStudyInput({ visibility: undefined }), openToPublic: false, openToVerified: true });
    await s.services.studies.transition(users.analystA, study.id, { action: "submit", expectedVersion: 1 });
    await s.services.studies.transition(users.admin, study.id, { action: "approve", expectedVersion: 2 });
    await s.services.studies.transition(users.admin, study.id, { action: "open", expectedVersion: 3 });
    expect(s.platform.state.createdMarkets[0]!.input).toMatchObject({ visibility: "PUBLIC", verifiedUsersOnly: true });
  });

  it("opens public and public-plus-verified questions as ordinary public markets", async () => {
    const s = setup();
    await openStudy(s, { visibility: undefined, openToVerified: true });
    expect(s.platform.state.createdMarkets[0]!.input).toMatchObject({ visibility: "PUBLIC", verifiedUsersOnly: false });
  });
});

describe("prize pool payout", () => {
  async function resolvedWithPrize(s: ReturnType<typeof setup>, prizePoolCredits: number) {
    const study = await openStudy(s, { prizePoolCredits });
    const resolved = (await s.repo.updateStudy(study.id, study.version, { status: "RESOLVED", resolvedOutcome: "YES", resolvedAt: new Date() }))!;
    return resolved;
  }

  it("waits for settlement, pays once, records it and tells the firm", async () => {
    const s = setup();
    const study = await resolvedWithPrize(s, 900);
    expect(await s.services.studies.payPrizePools()).toEqual({ paid: 0, pending: 1, failed: 0 });

    s.platform.state.settledGains.set(study.marketId!, [
      { userId: "t1", gain: 200 },
      { userId: "t2", gain: 100 },
      { userId: "t3", gain: -300 },
    ]);
    expect(await s.services.studies.payPrizePools()).toEqual({ paid: 1, pending: 0, failed: 0 });
    expect(s.platform.state.prizePayouts).toEqual([
      { studyId: study.id, userId: "t1", amount: 600 },
      { studyId: study.id, userId: "t2", amount: 300 },
    ]);
    expect((await s.repo.findStudy(study.id))!.prizeDistributedAt).not.toBeNull();
    expect(s.repo.alerts.some((a) => a.title === "Prize pool paid" && a.studyId === study.id)).toBe(true);

    // Already paid: skipped.
    expect(await s.services.studies.payPrizePools()).toEqual({ paid: 0, pending: 0, failed: 0 });
    expect(s.platform.state.prizePayouts).toHaveLength(2);
  });

  it("closes out a pool no one won, and ignores studies without one", async () => {
    const s = setup();
    const lost = await resolvedWithPrize(s, 500);
    await resolvedWithPrize(s, 0);
    s.platform.state.settledGains.set(lost.marketId!, [{ userId: "t1", gain: -100 }]);
    expect(await s.services.studies.payPrizePools()).toEqual({ paid: 1, pending: 0, failed: 0 });
    expect(s.platform.state.prizePayouts).toEqual([]);
    expect(s.repo.alerts.some((a) => a.title === "Prize pool not paid")).toBe(true);
  });
});

describe("question catalog", () => {
  it("lists only startups with an outcome the model has public data for", async () => {
    const s = setup();
    s.model.noPublicData.add("globex");
    const catalog = await s.services.openingLine.questionCatalog();
    expect(catalog.map((c) => c.startup.id)).toEqual(["startup_1"]);
    expect(catalog[0]!.metrics.every((m) => m.hasPublicData)).toBe(true);
  });
});

describe("outcome kinds on the model's real data", () => {
  const store = new FileModelStore();
  const asOf = new Date("2026-10-10T12:00:00Z");
  const stripe = { id: "st", name: "Stripe", slug: "stripe" };

  it("offers downloads, web rank, hiring and SEC filings for a company with those sources", () => {
    const kinds = modelMetricsFor(store, stripe).map((m) => m.kind);
    expect(kinds).toEqual(expect.arrayContaining(["weekly_total", "rank_average", "count_on_day", "event_by_date"]));
    const filing = modelMetricsFor(store, stripe).find((m) => m.kind === "event_by_date")!;
    expect(filing.thresholdLabel).toBeNull();
    expect(modelMetricsFor(store, { name: "Nobody", slug: "nobody" })).toEqual([]);
  });

  it("prices each kind with a templated question and a public resolution source", () => {
    for (const [metricId, threshold] of [
      ["tranco_rank", 1500],
      ["open_jobs", 60],
      ["formd_amount_sold", 1],
    ] as const) {
      const e = estimateWithModel(store, { startup: stripe, link: { metricId, threshold, targetDate: "2026-11-24" }, observations: [], asOf });
      expect(e.status).toBe("OK");
      expect(e.probability).toBeGreaterThan(0);
      expect(e.probability).toBeLessThan(1);
      expect(e.question).toMatch(/^Will .+\?$/);
      expect(e.yesCriteria).toMatch(/^YES if/);
      expect(e.resolutionSource?.url).toMatch(/^https:\/\//);
      expect(e.methodology).toMatch(/Model uncertainty band/);
    }
  });
});
