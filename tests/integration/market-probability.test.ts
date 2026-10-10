import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { submitForecastForUser } from "@/lib/forecasting/server/api";
import { getMarket, getMarketHistory, listMarkets } from "@/lib/market-view/queries";
import { pricesAfterTrades } from "@/lib/market-view/probability";
import { makeAdmin, makeMarket, makeUser, placeForecast, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const query = { status: "OPEN" as const, sort: "newest" as const, limit: 20, q: undefined, industry: undefined, cursor: undefined };

describe("market probability", () => {
  it("replays older trades that didn't store a price, like the seeded demo data", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin, { open: true });
    const user = await makeUser();
    // A snapshot written the old way: credits only, no generalEstimate.
    const forecast = await placeForecast(user, market.id, 100);
    await db.marketSnapshot.create({
      data: { marketId: market.id, sequence: 2, trigger: "FORECAST", forecastId: forecast.id, yesCredits: 100, noCredits: 0, allocationShare: 1, forecastCount: 1, forecasterCount: 1 },
    });

    const expected = pricesAfterTrades(market.openingBaseline, [{ side: "YES", credits: 100 }])[0]!;
    const history = await getMarketHistory(market.id);
    expect(history.map((p) => p.share)).toEqual([expect.closeTo(market.openingBaseline!, 6), expect.closeTo(expected, 6)]);

    const [listed] = (await listMarkets(query)).items;
    expect(listed!.probability).toBeCloseTo(expected, 6);
    // The credit split stays separate: all credits are on YES, but the price isn't 100%.
    expect(listed!.allocation.share).toBe(1);
    expect((await getMarket(market.slug))!.probability).toBeCloseTo(expected, 6);
  });

  it("uses the price the engine stored on new trades", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin, { open: true });
    await submitForecastForUser(await makeUser(), { marketId: market.id, side: "NO", credits: 80, idempotencyKey: "k1" });

    const stored = await db.marketSnapshot.findFirstOrThrow({ where: { marketId: market.id }, orderBy: { sequence: "desc" } });
    expect(stored.generalEstimate).not.toBeNull();
    expect((await getMarketHistory(market.id)).at(-1)!.share).toBeCloseTo(stored.generalEstimate!, 6);
    expect((await listMarkets(query)).items[0]!.probability).toBeCloseTo(stored.generalEstimate!, 6);
  });

  it("shows the opening price before anyone trades", async () => {
    const admin = await makeAdmin();
    const market = await makeMarket(admin, { open: true });
    expect((await listMarkets(query)).items[0]!.probability).toBeCloseTo(market.openingBaseline!, 6);
  });
});
