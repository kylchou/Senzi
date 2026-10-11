import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getCreditBalance } from "@/lib/credits";
import { submitForecastForUser } from "@/lib/forecasting/server/api";
import { resolveMarket } from "@/lib/resolutions";
import { makeAdmin, makeMarket, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const evidence = { evidenceSummary: "The company announced it.", evidenceUrls: ["https://example.com/press"] };

// End to end with the real forecasting engine: approving a resolution pays out.
describe("resolution payouts", () => {
  async function tradedMarket() {
    const alice = await makeAdmin();
    const bob = await makeAdmin();
    const market = await makeMarket(alice, { open: true });
    const yesUser = await makeUser();
    const noUser = await makeUser();
    await submitForecastForUser(yesUser, { marketId: market.id, side: "YES", credits: 100, idempotencyKey: "y1" });
    await submitForecastForUser(noUser, { marketId: market.id, side: "NO", credits: 100, idempotencyKey: "n1" });
    return { alice, bob, market, yesUser, noUser };
  }

  it("pays the winning side when the resolution is approved", async () => {
    const { alice, bob, market, yesUser, noUser } = await tradedMarket();
    const before = { yes: await getCreditBalance(yesUser.id), no: await getCreditBalance(noUser.id) };

    const resolution = await resolveMarket(alice, market.id, { outcome: "YES", ...evidence }, {}, { approver: bob });
    expect(await db.resolution.findUniqueOrThrow({ where: { id: resolution.id } })).toMatchObject({ settlementStatus: "COMPLETED" });

    expect(await getCreditBalance(yesUser.id)).toBeGreaterThan(before.yes + 100);
    expect(await getCreditBalance(noUser.id)).toBe(before.no);
    expect(await db.forecast.count({ where: { marketId: market.id, status: "SETTLED" } })).toBe(2);
  });

  it("refunds everyone on VOID", async () => {
    const { alice, bob, market, yesUser, noUser } = await tradedMarket();
    const before = { yes: await getCreditBalance(yesUser.id), no: await getCreditBalance(noUser.id) };

    await resolveMarket(alice, market.id, { outcome: "VOID", voidReason: "CANCELLED", ...evidence }, {}, { approver: bob });

    expect(await getCreditBalance(yesUser.id)).toBe(before.yes + 100);
    expect(await getCreditBalance(noUser.id)).toBe(before.no + 100);
  });
});
