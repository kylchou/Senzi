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

    expect(await s.services.studies.syncWithMarkets()).toEqual({ closed: 1, resolved: 0, corrected: 0, failed: 1 });
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
    await expect(s.services.watchlists.follow(users.analystA, { type: "STARTUP", startupId: "hidden" })).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "NOT_FOUND",
    );
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
    await s.services.watchlists.follow(users.analystB, { type: "STARTUP", startupId: "startup_1" });

    const [entry] = (await s.services.watchlists.overview(users.analystB)).followed;
    const markets = entry!.openMarkets.filter((m) => m.kind === "market").map((m) => (m.kind === "market" ? m.market.id : ""));
    const studies = entry!.openMarkets.flatMap((m) => (m.kind === "study" ? [m.study] : []));
    expect(markets).toEqual(["plain"]);
    expect(studies.map((x) => x.id)).toEqual([theirs.id]);
    expect(studies[0]!.viewLevel).toBe("limited");
  });

  it("never shows another firm's private study", async () => {
    const s = setup();
    await openStudy(s, { visibility: "ORGANIZATION" });
    await s.services.watchlists.follow(users.analystB, { type: "STARTUP", startupId: "startup_1" });
    const [entry] = (await s.services.watchlists.overview(users.analystB)).followed;
    expect(entry!.openMarkets.filter((m) => m.kind === "study")).toEqual([]);
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

describe("resolution corrections", () => {
  async function resolvedStudy(s: ReturnType<typeof setup>) {
    const study = await openStudy(s);
    const resolution = { outcome: "YES" as const, resolvedAt: s.deps.now(), evidenceUrls: ["https://example.com/pr"], evidenceSummary: "Announced" };
    s.forecasting.estimates.set(study.marketId!, makeEstimate(study.marketId!, { status: "RESOLVED", resolution }));
    await s.services.studies.syncWithMarkets();
    return { study: (await s.repo.findStudy(study.id))!, resolution };
  }

  it("updates the study when an admin corrects the market's outcome, once", async () => {
    const s = setup();
    const { study, resolution } = await resolvedStudy(s);
    expect(study).toMatchObject({ status: "RESOLVED", resolvedOutcome: "YES" });

    s.forecasting.estimates.set(study.marketId!, makeEstimate(study.marketId!, { status: "RESOLVED", resolution: { ...resolution, outcome: "NO" } }));
    expect(await s.services.studies.syncWithMarkets()).toMatchObject({ corrected: 1, failed: 0 });
    const after = (await s.repo.findStudy(study.id))!;
    expect(after).toMatchObject({ status: "RESOLVED", resolvedOutcome: "NO" });

    const event = s.repo.events.find((e) => e.studyId === study.id && e.action === "correct_resolution")!;
    expect(event).toMatchObject({ actorId: null, fromStatus: "RESOLVED", toStatus: "RESOLVED", reason: "Outcome corrected from YES to NO" });
    expect(s.repo.alerts.some((a) => a.studyId === study.id && a.title === "Study outcome corrected: YES → NO")).toBe(true);

    // Nothing more to do on the next run.
    expect(await s.services.studies.syncWithMarkets()).toMatchObject({ corrected: 0 });
  });

  it("ignores evidence-only corrections", async () => {
    const s = setup();
    const { study, resolution } = await resolvedStudy(s);
    s.forecasting.estimates.set(
      study.marketId!,
      makeEstimate(study.marketId!, { status: "RESOLVED", resolution: { ...resolution, evidenceSummary: "Updated evidence" } }),
    );
    expect(await s.services.studies.syncWithMarkets()).toMatchObject({ corrected: 0 });
    expect(s.repo.events.some((e) => e.action === "correct_resolution")).toBe(false);
  });

  it("stops checking long after resolution", async () => {
    const s = setup();
    const { study, resolution } = await resolvedStudy(s);
    s.setNow(new Date(s.deps.now().getTime() + 91 * 24 * 60 * 60 * 1000));
    s.forecasting.estimates.set(study.marketId!, makeEstimate(study.marketId!, { status: "RESOLVED", resolution: { ...resolution, outcome: "NO" } }));
    expect(await s.services.studies.syncWithMarkets()).toMatchObject({ corrected: 0 });
  });
});
