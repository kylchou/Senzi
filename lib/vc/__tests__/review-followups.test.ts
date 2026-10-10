import { describe, expect, it } from "vitest";
import { VcError } from "../errors";
import { makeEstimate } from "../testing/memory";
import { DAY, NOW, openStudy, setup, users, validStudyInput } from "./fixtures";

describe("closing a study closes its market", () => {
  it("closes the market when a platform admin closes the study", async () => {
    const s = setup();
    const study = await openStudy(s);
    await s.services.studies.transition(users.admin, study.id, { action: "close", expectedVersion: study.version });
    expect(s.platform.state.closedMarketStudyIds).toEqual([study.id]);
    expect((await s.repo.findStudy(study.id))!.status).toBe("CLOSED");
  });

  it("closes the market when the deadline passes", async () => {
    const s = setup();
    const study = await openStudy(s);
    s.setNow(new Date(study.deadline.getTime() + 1000));
    await s.services.studies.syncWithMarkets();
    expect(s.platform.state.closedMarketStudyIds).toEqual([study.id]);
  });

  it("does not mark the study closed if closing the market fails", async () => {
    const s = setup();
    const study = await openStudy(s);
    s.platform.closeMarketForStudy = async () => {
      throw new Error("database unavailable");
    };
    await expect(
      s.services.studies.transition(users.admin, study.id, { action: "close", expectedVersion: study.version }),
    ).rejects.toThrow("database unavailable");
    expect((await s.repo.findStudy(study.id))!.status).toBe("OPEN");
  });
});

describe("sync keeps going when one study fails", () => {
  it("skips the failing study and processes the rest", async () => {
    const s = setup();
    const first = await openStudy(s);
    const second = await openStudy(s);
    const updateStudy = s.repo.updateStudy.bind(s.repo);
    s.repo.updateStudy = async (id, ...rest) => {
      if (id === first.id) throw new Error("boom");
      return updateStudy(id, ...rest);
    };
    s.setNow(new Date(first.deadline.getTime() + 1000));

    expect(await s.services.studies.syncWithMarkets()).toEqual({ closed: 1, resolved: 0, failed: 1 });
    expect((await s.repo.findStudy(second.id))!.status).toBe("CLOSED");
  });
});

describe("unpublished startups", () => {
  it("can't be used for studies or watchlists", async () => {
    const s = setup();
    s.platform.state.startups.push({ id: "hidden", name: "Hidden Co", slug: "hidden", industry: null, isPublished: false });
    await expect(s.services.studies.create(users.analystA, validStudyInput({ startupId: "hidden" }))).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "VALIDATION_ERROR",
    );
    const wl = await s.services.watchlists.create(users.analystA, "Core");
    await expect(
      s.services.watchlists.addItem(users.analystA, wl.id, { type: "STARTUP", startupId: "hidden" }),
    ).rejects.toSatisfy((e: unknown) => e instanceof VcError && e.code === "NOT_FOUND");
  });
});

describe("watched startups", () => {
  it("shows another firm's public study as a study, never as a bare public market", async () => {
    const s = setup();
    const theirs = await openStudy(s, { visibility: "PUBLIC" });
    s.forecasting.estimates.set(theirs.marketId!, makeEstimate(theirs.marketId!));
    s.platform.state.markets.push(
      { id: theirs.marketId!, studyId: theirs.id, startupId: "startup_1", question: theirs.question, status: "OPEN", closesAt: null, visibility: "PUBLIC" },
      { id: "plain", startupId: "startup_1", question: "Plain public market?", status: "OPEN", closesAt: null, visibility: "PUBLIC" },
    );
    const wl = await s.services.watchlists.create(users.analystB, "B list");
    await s.services.watchlists.addItem(users.analystB, wl.id, { type: "STARTUP", startupId: "startup_1" });

    const [detail] = await s.services.watchlists.list(users.analystB);
    const entry = detail.entries[0];
    if (entry.kind !== "STARTUP") throw new Error("expected a startup entry");
    expect(entry.markets.map((m) => m.market.id)).toEqual(["plain"]);
    expect(entry.studies.map((x) => x.study.id)).toEqual([theirs.id]);
    expect(entry.studies[0].study.viewLevel).toBe("limited");
  });

  it("never shows another firm's private study", async () => {
    const s = setup();
    await openStudy(s, { visibility: "ORGANIZATION" });
    const wl = await s.services.watchlists.create(users.analystB, "B list");
    await s.services.watchlists.addItem(users.analystB, wl.id, { type: "STARTUP", startupId: "startup_1" });
    const [detail] = await s.services.watchlists.list(users.analystB);
    const entry = detail.entries[0];
    if (entry.kind !== "STARTUP") throw new Error("expected a startup entry");
    expect(entry.studies).toEqual([]);
  });
});

describe("unread alert badge", () => {
  it("counts only alerts on studies the user can see", async () => {
    const s = setup();
    await openStudy(s, { visibility: "RESTRICTED", deadline: new Date(NOW.getTime() + 2 * DAY) });
    await s.services.alerts.evaluate();
    // The author sees the 3 status alerts plus the deadline alert; a firm viewer sees none of them.
    expect(await s.services.alerts.unreadCount(users.analystA)).toBe(4);
    expect(await s.services.alerts.unreadCount(users.viewerA)).toBe(0);
    await s.repo.createAlerts([{ organizationId: "org_a", type: "STUDY_STATUS_CHANGED", title: "General", body: "", dedupeKey: "general" }]);
    expect(await s.services.alerts.unreadCount(users.viewerA)).toBe(1);
  });
});
