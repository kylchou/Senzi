import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/model/dates";
import { refreshMarketModels } from "@/lib/model/market-refresh";
import { MemoryModelStore } from "@/lib/model/store";
import { syntheticDaily } from "@/lib/model/test-helpers";
import { makeAdmin, makeMarket, resetDatabase } from "../helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const now = new Date();
const today = now.toISOString().slice(0, 10);

/** Daily Tranco ranks for posthog ending yesterday. `level` is the first day's rank. */
const ranks = (days: number, level: number) =>
  syntheticDaily({ companyId: "posthog", metricId: "tranco_rank", start: addDays(today, -days), days, level, weeklyGrowth: -0.01, noise: 0.005, seed: 3 })
    .map((p) => ({ ...p, source: "tranco" as const, availableAt: `${p.periodEnd}T12:00:00.000Z` }))
    .filter((p) => Date.parse(p.availableAt) <= now.getTime());

/** An open traffic-rank market on the catalog company "posthog". */
async function rankMarket() {
  const admin = await makeAdmin();
  const startup = await db.startup.create({
    data: { slug: "posthog", name: "PostHog", tagline: "t", description: "d", industry: "Testing", stage: "GROWTH", isPublished: true },
  });
  const market = await makeMarket(admin, { startupId: startup.id });
  await db.modelQuestionSpec.create({
    data: {
      marketId: market.id,
      metricId: "tranco_rank",
      threshold: 2100,
      windowEnd: new Date(`${addDays(today, 20)}T00:00:00Z`),
      resolutionSource: "TRANCO",
      resolutionSourceUrl: "https://tranco-list.eu/api/ranks/domain/posthog.com",
    },
  });
  return market;
}

describe("refreshMarketModels (traffic rank)", () => {
  it("publishes a new model value when data changes, and nothing when it doesn't", async () => {
    const market = await rankMarket();
    const first = await refreshMarketModels({ now, store: new MemoryModelStore(ranks(40, 2150)) });
    expect(first).toMatchObject({ checked: 1, published: 1, unchanged: 0 });

    const after = await db.market.findUniqueOrThrow({ where: { id: market.id } });
    const snaps = await db.modelBaselineSnapshot.findMany({ where: { marketId: market.id } });
    expect(snaps).toHaveLength(1);
    expect(after.modelValue).toBeCloseTo(snaps[0]!.probability!, 6);
    expect(await db.marketSnapshot.count({ where: { marketId: market.id, trigger: "MODEL_UPDATE" } })).toBeGreaterThanOrEqual(1);

    // Same data: idempotent.
    const again = await refreshMarketModels({ now, store: new MemoryModelStore(ranks(40, 2150)) });
    expect(again).toMatchObject({ published: 0, unchanged: 1 });

    // New data (the site slips well behind the line): a new, lower value.
    const later = new Date(now.getTime() + 1000);
    const worse = await refreshMarketModels({ now: later, store: new MemoryModelStore(ranks(40, 3000)) });
    expect(worse.published).toBe(1);
    const updated = await db.market.findUniqueOrThrow({ where: { id: market.id } });
    expect(updated.modelValue!).toBeLessThan(after.modelValue!);
    expect(await db.modelBaselineSnapshot.count({ where: { marketId: market.id } })).toBe(2);
  });

  it("leaves the last value in place when the model can't price the market", async () => {
    const market = await rankMarket();
    const r = await refreshMarketModels({ now, store: new MemoryModelStore([]) });
    expect(r).toMatchObject({ checked: 1, published: 0 });
    expect(r.skipped[0]?.marketId).toBe(market.id);
    expect(await db.modelBaselineSnapshot.count({ where: { marketId: market.id } })).toBe(0);
  });
});
