import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { submitForecastForUser } from "@/lib/forecasting/server/api";
import {
  createAccessCode,
  isVerifiedUserOf,
  productVerificationStatus,
  redeemAccessCode,
  reviewProductVerification,
  revokeAccessCode,
  submitScreenshot,
} from "@/lib/product-verification";
import { makeAdmin, makeMarket, makeStartup, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterEach(() => vi.unstubAllEnvs());
afterAll(() => db.$disconnect());

// The smallest valid PNG header is enough for the type check.
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const codeFor = async (startupId: string, extra: { maxUses?: number; code?: string } = {}) =>
  (await createAccessCode(await makeAdmin(), { startupId, code: extra.code ?? null, label: null, maxUses: extra.maxUses ?? null, expiresInDays: null })).code;

describe("access codes", () => {
  it("verify instantly, ignore case and dashes, and don't use a slot twice", async () => {
    const startup = await makeStartup();
    const user = await makeUser();
    await codeFor(startup.id, { code: "STRIPE-DEMO", maxUses: 1 });

    await redeemAccessCode(user, startup.id, "stripe demo");
    expect(await isVerifiedUserOf(user.id, startup.id)).toBe(true);
    // Already verified: no new row, no use counted.
    await redeemAccessCode(user, startup.id, "STRIPE-DEMO");
    expect(await db.productUserVerification.count({ where: { userId: user.id } })).toBe(1);
    expect((await db.productAccessCode.findFirstOrThrow()).useCount).toBe(1);

    // The single use is gone for everyone else.
    await expect(redeemAccessCode(await makeUser(), startup.id, "STRIPE-DEMO")).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("reject wrong, other-startup, and revoked codes with the same message", async () => {
    const startup = await makeStartup();
    const other = await makeStartup();
    const user = await makeUser();
    const code = await codeFor(other.id);
    await expect(redeemAccessCode(user, startup.id, "NOPE-NOPE-NOPE")).rejects.toThrow(/isn't valid/);
    await expect(redeemAccessCode(user, startup.id, code)).rejects.toThrow(/isn't valid/);

    const mine = await codeFor(startup.id);
    const row = await db.productAccessCode.findFirstOrThrow({ where: { startupId: startup.id } });
    await revokeAccessCode(await makeAdmin(), row.id);
    await expect(redeemAccessCode(user, startup.id, mine)).rejects.toThrow(/isn't valid/);
    expect(await isVerifiedUserOf(user.id, startup.id)).toBe(false);
  });

  it("only stores a hash of the code", async () => {
    const startup = await makeStartup();
    const code = await codeFor(startup.id);
    const row = await db.productAccessCode.findFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.hint).toBe(code.replace(/-/g, "").slice(-4));
  });
});

describe("screenshots", () => {
  it("wait for an admin, then unlock with a notification and an audit entry", async () => {
    const startup = await makeStartup();
    const user = await makeUser();
    const submitted = await submitScreenshot(user, startup.id, { bytes: png, note: "My dashboard" });
    await expect(submitScreenshot(user, startup.id, { bytes: png })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await productVerificationStatus(user.id, startup.id)).pending?.id).toBe(submitted.id);

    await reviewProductVerification(await makeAdmin(), submitted.id, { decision: "APPROVED", note: null });
    expect(await isVerifiedUserOf(user.id, startup.id)).toBe(true);
    expect(await db.notification.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "productVerification.review" } })).toBe(1);
  });

  it("refuse files that aren't images, and admins reviewing their own", async () => {
    vi.stubEnv("SENZI_ALLOW_SELF_APPROVAL", "false");
    const startup = await makeStartup();
    const user = await makeUser();
    await expect(submitScreenshot(user, startup.id, { bytes: new TextEncoder().encode("<svg onload=alert(1)>") })).rejects.toThrow(/PNG/);

    const admin = await makeAdmin();
    const own = await submitScreenshot(admin, startup.id, { bytes: png });
    await expect(reviewProductVerification(admin, own.id, { decision: "APPROVED", note: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("are closed when the user verifies with a code instead", async () => {
    const startup = await makeStartup();
    const user = await makeUser();
    const pending = await submitScreenshot(user, startup.id, { bytes: png });
    await redeemAccessCode(user, startup.id, await codeFor(startup.id));
    expect((await db.productUserVerification.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("REJECTED");
  });
});

describe("verified-users markets", () => {
  it("only let verified users trade, and mark their forecasts verified", async () => {
    const admin = await makeAdmin();
    const startup = await makeStartup();
    const market = await makeMarket(admin, { open: true, startupId: startup.id, verifiedUsersOnly: true });
    const user = await makeUser();
    const trade = (key: string) => submitForecastForUser(user, { marketId: market.id, side: "YES", credits: 50, idempotencyKey: key });

    await expect(trade("before")).rejects.toMatchObject({ code: "FORBIDDEN", details: { reason: "NOT_VERIFIED" } });

    await redeemAccessCode(user, startup.id, await codeFor(startup.id));
    await trade("after");
    const forecast = await db.forecast.findFirstOrThrow({ where: { userId: user.id } });
    expect(forecast.verifiedAtEntry).toBe(true);
  });

  it("still let anyone trade on ordinary markets", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin, { open: true });
    const user = await makeUser();
    await submitForecastForUser(user, { marketId: market.id, side: "NO", credits: 50, idempotencyKey: "plain" });
    expect((await db.forecast.findFirstOrThrow({ where: { userId: user.id } })).verifiedAtEntry).toBe(false);
  });
});
