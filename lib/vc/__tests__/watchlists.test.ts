import { describe, expect, it } from "vitest";
import { VcError } from "../errors";
import { DEFAULT_WATCHLIST_NAME } from "../services/watchlists";
import { makeEstimate } from "../testing/memory";
import { openStudy, setup, users } from "./fixtures";

const code = (c: VcError["code"]) => (e: unknown) => e instanceof VcError && e.code === c;
const ACME = { type: "STARTUP" as const, startupId: "startup_1" };

describe("watchlist (following, no lists)", () => {
  it("follows into one hidden list per firm, idempotently, and unfollows", async () => {
    const s = setup();
    await s.services.watchlists.follow(users.analystA, ACME);
    await s.services.watchlists.follow(users.analystA2, ACME);
    const lists = await s.repo.listWatchlists("org_a");
    expect(lists.map((w) => w.name)).toEqual([DEFAULT_WATCHLIST_NAME]);
    expect(lists[0]!.items).toHaveLength(1);
    expect(await s.services.watchlists.isFollowing(users.analystA, ACME)).toBe(true);

    await s.services.watchlists.unfollow(users.analystA, ACME);
    expect(await s.services.watchlists.isFollowing(users.analystA, ACME)).toBe(false);
  });

  it("is scoped to the firm, and viewers can look but not follow", async () => {
    const s = setup();
    await s.services.watchlists.follow(users.analystA, ACME);
    expect(await s.services.watchlists.isFollowing(users.analystB, ACME)).toBe(false);
    expect((await s.services.watchlists.overview(users.analystB)).followed).toEqual([]);
    await expect(s.services.watchlists.follow(users.viewerA, ACME)).rejects.toSatisfy(code("FORBIDDEN"));
    expect(await s.services.watchlists.isFollowing(users.viewerA, ACME)).toBeNull();
    expect((await s.services.watchlists.overview(users.viewerA)).canEdit).toBe(false);
  });

  it("counts older named lists, and unfollow clears the startup from all of them", async () => {
    const s = setup();
    const old = (await s.repo.createWatchlist({ organizationId: "org_a", name: "Pipeline", createdById: "analyst_a" }))!;
    await s.repo.addWatchlistItem({ watchlistId: old.id, type: "STARTUP", startupId: "startup_1", studyId: null, addedById: "analyst_a" });
    expect((await s.services.watchlists.overview(users.analystA)).followed.map((w) => w.startup.id)).toEqual(["startup_1"]);
    await s.services.watchlists.follow(users.analystA, ACME); // already followed via the old list: no duplicate
    expect((await s.repo.listWatchlists("org_a")).flatMap((w) => w.items)).toHaveLength(1);
    await s.services.watchlists.unfollow(users.analystA, ACME);
    expect((await s.repo.listWatchlists("org_a")).flatMap((w) => w.items)).toHaveLength(0);
  });

  it("can't follow another firm's private study or an unknown startup", async () => {
    const s = setup();
    const priv = await openStudy(s);
    await expect(s.services.watchlists.follow(users.analystB, { type: "STUDY", studyId: priv.id })).rejects.toSatisfy(code("NOT_FOUND"));
    await expect(s.services.watchlists.follow(users.analystA, { type: "STARTUP", startupId: "nope" })).rejects.toSatisfy(code("NOT_FOUND"));
  });

  it("shows a searched startup's scraped signals and open markets, whether or not it's followed", async () => {
    const s = setup();
    const own = await openStudy(s);
    s.forecasting.estimates.set(own.marketId!, makeEstimate(own.marketId!));
    s.indicators.bySlug.set("acme", {
      status: "ok",
      rows: [{ metricId: "npm", label: "npm downloads", unit: "downloads", value: 1200, asOf: "2026-09-30", change4w: 0.1, sourceUrl: "https://x", provenanceLabel: "Scraped", missingReason: null }],
    });
    s.platform.state.markets.push(
      { id: "pub1", startupId: "startup_1", question: "Public Q?", status: "OPEN", closesAt: null, visibility: "PUBLIC" },
      { id: "pub2", startupId: "startup_1", question: "Closed Q?", status: "CLOSED", closesAt: null, visibility: "PUBLIC" },
      { id: "priv1", startupId: "startup_1", question: "Private Q?", status: "OPEN", closesAt: null, visibility: "ORGANIZATION" },
    );

    const view = await s.services.watchlists.overview(users.analystA, "startup_1");
    expect(view.selected).toMatchObject({ following: false, indicators: { status: "ok" } });
    expect(view.selected!.indicators.rows[0]!.value).toBe(1200);
    const ids = view.selected!.openMarkets.map((m) => (m.kind === "study" ? m.study.id : m.market.id));
    expect(ids.sort()).toEqual([own.id, "pub1"].sort());
    const study = view.selected!.openMarkets.find((m) => m.kind === "study")!;
    expect(study.estimate?.allocation.yesShare).toBe(0.6);
  });
});
