import { describe, expect, it } from "vitest";
import { VcError } from "../errors";
import { makeEstimate } from "../testing/memory";
import { openStudy, setup, users } from "./fixtures";

describe("watchlists", () => {
  it("is scoped to the organization", async () => {
    const s = setup();
    const wl = await s.services.watchlists.create(users.analystA, "Core");
    expect(await s.services.watchlists.list(users.analystB)).toEqual([]);
    await expect(s.services.watchlists.remove(users.analystB, wl.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "NOT_FOUND",
    );
    await expect(
      s.services.watchlists.addItem(users.analystB, wl.id, { type: "STARTUP", startupId: "startup_1" }),
    ).rejects.toBeInstanceOf(VcError);
  });

  it("rejects duplicate names and viewer edits", async () => {
    const s = setup();
    await s.services.watchlists.create(users.analystA, "Core");
    await expect(s.services.watchlists.create(users.analystA, "Core")).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "CONFLICT",
    );
    await expect(s.services.watchlists.create(users.viewerA, "Other")).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "FORBIDDEN",
    );
  });

  it("cannot follow another firm's private study", async () => {
    const s = setup();
    const priv = await openStudy(s);
    const wl = await s.services.watchlists.create(users.analystB, "B list");
    await expect(
      s.services.watchlists.addItem(users.analystB, wl.id, { type: "STUDY", studyId: priv.id }),
    ).rejects.toSatisfy((e: unknown) => e instanceof VcError && e.code === "NOT_FOUND");
  });

  it("enriches startup entries with public markets and the firm's own studies", async () => {
    const s = setup();
    const own = await openStudy(s);
    s.forecasting.estimates.set(own.marketId!, makeEstimate(own.marketId!));
    s.platform.state.markets.push(
      { id: "pub1", startupId: "startup_1", question: "Public Q?", status: "OPEN", closesAt: null, visibility: "PUBLIC" },
      { id: "priv1", startupId: "startup_1", question: "Private Q?", status: "OPEN", closesAt: null, visibility: "ORGANIZATION" },
    );
    const wl = await s.services.watchlists.create(users.analystA, "Core");
    await s.services.watchlists.addItem(users.analystA, wl.id, { type: "STARTUP", startupId: "startup_1" });
    // Idempotent add
    await s.services.watchlists.addItem(users.analystA, wl.id, { type: "STARTUP", startupId: "startup_1" });

    const [detail] = await s.services.watchlists.list(users.analystA);
    expect(detail.entries).toHaveLength(1);
    const entry = detail.entries[0];
    if (entry.kind !== "STARTUP") throw new Error("expected startup entry");
    expect(entry.markets.map((m) => m.market.id)).toEqual(["pub1"]);
    expect(entry.studies.map((x) => x.study.id)).toEqual([own.id]);
    expect(entry.studies[0].estimate?.allocation.yesShare).toBe(0.6);
  });
});
