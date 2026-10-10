import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OrgRole } from "@/generated/prisma/enums";
import { createCreditLedger } from "@/lib/credit-ledger";
import { verifyLedgerIntegrity } from "@/lib/credits";
import { db } from "@/lib/db";
import { InsufficientBalanceError, isForecastingError } from "@/lib/forecasting/errors";
import { visibleModelDataPointsWhere } from "@/lib/permissions";
import { SIGNUP_GRANT_CREDITS } from "@/lib/types";
import { makeAdmin, makeMarket, makeOrg, makeStartup, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const DAY = 24 * 60 * 60 * 1000;

describe("credit ledger adapter for the forecasting engine", () => {
  const stake = (userId: string, amount: number, key = "forecast:f1") => ({
    userId,
    amount,
    reason: "forecast_stake",
    reference: "f1",
    idempotencyKey: key,
  });

  it("debits stakes and credits payouts with the right ledger types", async () => {
    const user = await makeUser();
    const ledger = createCreditLedger();

    const debit = await ledger.debit(stake(user.id, 300));
    expect(debit).toMatchObject({ delta: -300, balanceAfter: SIGNUP_GRANT_CREDITS - 300, reason: "forecast_stake", reference: "f1" });

    await ledger.credit({ userId: user.id, amount: 450, reason: "forecast_payout", reference: "f1", idempotencyKey: "settlement:m1:f1" });
    expect(await ledger.getBalance(user.id)).toBe(SIGNUP_GRANT_CREDITS + 150);

    const types = await db.creditTransaction.findMany({ where: { userId: user.id }, orderBy: { sequence: "asc" }, select: { type: true } });
    expect(types.map((t) => t.type)).toEqual(["SIGNUP_GRANT", "FORECAST_STAKE", "SETTLEMENT_PAYOUT"]);
    expect((await ledger.listTransactions(user.id)).map((t) => t.reason)).toEqual(["signup_grant", "forecast_stake", "forecast_payout"]);
    expect((await verifyLedgerIntegrity(user.id)).ok).toBe(true);
  });

  it("throws the engine's InsufficientBalanceError with the available balance", async () => {
    const user = await makeUser();
    const error = await createCreditLedger()
      .debit(stake(user.id, SIGNUP_GRANT_CREDITS + 1))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InsufficientBalanceError);
    expect((error as InsufficientBalanceError).details).toMatchObject({ requested: SIGNUP_GRANT_CREDITS + 1, available: SIGNUP_GRANT_CREDITS });
  });

  it("returns the original transaction when a key is retried, and flags reuse with a different amount", async () => {
    const user = await makeUser();
    const ledger = createCreditLedger();
    const first = await ledger.debit(stake(user.id, 100));
    const again = await ledger.debit(stake(user.id, 100));
    expect(again.id).toBe(first.id);

    const error = await ledger.debit(stake(user.id, 200)).catch((e: unknown) => e);
    expect(isForecastingError(error, "IDEMPOTENCY_CONFLICT")).toBe(true);
  });

  it("only accepts the reasons the engine uses", async () => {
    const user = await makeUser();
    const ledger = createCreditLedger();
    const error = await ledger
      .credit({ userId: user.id, amount: 1_000, reason: "free_money", reference: "x", idempotencyKey: "nope-0001" })
      .catch((e: unknown) => e);
    expect(isForecastingError(error, "VALIDATION_FAILED")).toBe(true);
    // A stake reason can't be used to credit, and a payout reason can't debit.
    await expect(ledger.credit({ ...stake(user.id, 10), idempotencyKey: "nope-0002" })).rejects.toThrow();
  });

  it("joins a caller's transaction when given one", async () => {
    const user = await makeUser();
    await expect(
      db.$transaction(async (tx) => {
        await createCreditLedger(tx).debit(stake(user.id, 100));
        throw new Error("forecast insert failed");
      }),
    ).rejects.toThrow("forecast insert failed");
    expect(await createCreditLedger().getBalance(user.id)).toBe(SIGNUP_GRANT_CREDITS);
  });
});

describe("model data rules", () => {
  const point = (startupId: string, overrides: Record<string, unknown> = {}) => ({
    startupId,
    metricId: "npm_downloads:demo",
    source: "NPM" as const,
    value: 1234,
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-07"),
    availableAt: new Date("2026-09-08"),
    fetchedAt: new Date("2026-09-08"),
    sourceUrl: "https://api.npmjs.org/downloads/demo",
    provenance: "SCRAPED" as const,
    ...overrides,
  });

  it("dedupes scraped points for the same period even though organizationId is null", async () => {
    const startup = await makeStartup();
    await db.modelDataPoint.create({ data: point(startup.id) });
    await expect(db.modelDataPoint.create({ data: point(startup.id, { value: 99 }) })).rejects.toThrow();
  });

  it("ties provenance to source and organization", async () => {
    const startup = await makeStartup();
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    // Scraped data can't be simulated or belong to an org.
    await expect(db.modelDataPoint.create({ data: point(startup.id, { simulated: true }) })).rejects.toThrow();
    await expect(db.modelDataPoint.create({ data: point(startup.id, { organizationId: org.id }) })).rejects.toThrow();
    // Sponsor data must come from SPONSOR and name its org.
    await expect(db.modelDataPoint.create({ data: point(startup.id, { provenance: "SPONSOR_PROVIDED" }) })).rejects.toThrow();
    await db.modelDataPoint.create({
      data: point(startup.id, { provenance: "SPONSOR_PROVIDED", source: "SPONSOR", metricId: "sponsor_arr", organizationId: org.id }),
    });
  });

  it("rejects periods that end before they start", async () => {
    const startup = await makeStartup();
    await expect(
      db.modelDataPoint.create({ data: point(startup.id, { periodEnd: new Date("2026-08-01") }) }),
    ).rejects.toThrow();
  });

  it("shows sponsor data only to the sponsor's members", async () => {
    const startup = await makeStartup();
    const owner = await makeUser();
    const outsider = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    await db.modelDataPoint.create({ data: point(startup.id) });
    await db.modelDataPoint.create({
      data: point(startup.id, { provenance: "SPONSOR_PROVIDED", source: "SPONSOR", metricId: "sponsor_arr", organizationId: org.id }),
    });

    expect(await db.modelDataPoint.count({ where: visibleModelDataPointsWhere(owner.id) })).toBe(2);
    expect(await db.modelDataPoint.count({ where: visibleModelDataPointsWhere(outsider.id) })).toBe(1);
    expect(await db.modelDataPoint.count({ where: visibleModelDataPointsWhere(null) })).toBe(1);
  });

  it("locks a question's resolution source once the market has opened", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin); // opened a day ago
    const spec = await db.modelQuestionSpec.create({
      data: {
        marketId: market.id,
        metricId: "npm_downloads:demo",
        threshold: 10_000,
        windowEnd: new Date(Date.now() + 30 * DAY),
        resolutionSource: "NPM",
        resolutionSourceUrl: "https://api.npmjs.org/downloads/demo",
      },
    });
    await expect(
      db.modelQuestionSpec.update({ where: { id: spec.id }, data: { resolutionSource: "PYPISTATS" } }),
    ).rejects.toThrow(/locked/);
    // Other fields can still change.
    await db.modelQuestionSpec.update({ where: { id: spec.id }, data: { threshold: 12_000 } });
  });

  it("keeps baseline probabilities in range and empty when data is insufficient", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin);
    const base = {
      marketId: market.id,
      asOf: new Date(),
      modelName: "lognormal-growth",
      modelVersion: "1.0.0",
      method: {},
      inputsUsed: [],
      sources: [],
    };
    await expect(
      db.modelBaselineSnapshot.create({ data: { ...base, status: "OK", probability: 1.4, inputsHash: "a" } }),
    ).rejects.toThrow();
    await expect(
      db.modelBaselineSnapshot.create({ data: { ...base, status: "INSUFFICIENT_DATA", probability: 0.4, inputsHash: "b" } }),
    ).rejects.toThrow();
    await db.modelBaselineSnapshot.create({ data: { ...base, status: "OK", probability: 0.4, low: 0.3, high: 0.5, inputsHash: "c" } });
  });
});
