import { describe, expect, it } from "vitest";
import { checkCitations } from "../assistant/citations";
import { CAVEATS } from "../assistant/context";
import { renderContext } from "../assistant/render";
import { VcError } from "../errors";
import { createVcServices } from "../services";
import { makeEstimate } from "../testing/memory";
import type { EstimatePoint } from "../types";
import { DAY, NOW, openStudy, setup, users } from "./fixtures";

const code = (c: VcError["code"]) => (e: unknown) => e instanceof VcError && e.code === c;

/** An open study with a market, history, facts and news. */
async function richStudy(s: ReturnType<typeof setup>, visibility: "ORGANIZATION" | "PUBLIC" | "RESTRICTED" = "ORGANIZATION") {
  const study = await openStudy(s, { visibility });
  const m = study.marketId!;
  s.forecasting.estimates.set(
    m,
    makeEstimate(m, {
      allocation: { yesCredits: 580, noCredits: 420, totalCredits: 1000, yesShare: 0.58 },
      participantCount: 6,
      openingBaseline: { value: 0.35, methodology: "Base rate" },
    }),
  );
  const point = (id: string, daysAgo: number, share: number): EstimatePoint => ({
    id,
    at: new Date(NOW.getTime() - daysAgo * DAY),
    yesShare: share,
    totalCredits: 1000,
    participantCount: 6,
  });
  s.forecasting.histories.set(m, [point("snap_first", 20, 0.36), point("snap_week", 8, 0.41), point("snap_mid", 3, 0.5), point("snap_last", 0, 0.58)]);
  s.platform.state.facts.push({
    id: "f1", startupId: "startup_1", label: "Series B", value: "$40M", sourceName: "TechCrunch",
    sourceUrl: "https://example.com/b", asOf: new Date(NOW.getTime() - 200 * DAY), verified: true,
  });
  s.platform.state.news.push({
    id: "n1", startupId: "startup_1", title: "Utility contract signed", summary: null, publisher: "Utility Dive",
    url: "https://example.com/n", publishedAt: new Date(NOW.getTime() - 3 * DAY), verification: "UNVERIFIED",
  });
  return study;
}

describe("study context: authorization", () => {
  it("returns NOT_FOUND to other firms and outsiders before reading anything", async () => {
    const s = setup();
    const study = await richStudy(s);
    await expect(s.services.assistantContext.forStudy(users.analystB, study.id)).rejects.toSatisfy(code("NOT_FOUND"));
    await expect(s.services.assistantContext.forStudy(users.outsider, study.id)).rejects.toSatisfy(code("NOT_FOUND"));
  });

  it("refuses restricted studies at the standard tier, even for their author", async () => {
    const s = setup();
    const study = await richStudy(s, "RESTRICTED");
    await expect(s.services.assistantContext.forStudy(users.analystA, study.id)).rejects.toSatisfy(code("FORBIDDEN"));
  });

  it("allows restricted studies at the extended tier, but only for people who can see them", async () => {
    const s = setup();
    const study = await richStudy(s, "RESTRICTED");
    const extended = createVcServices(s.deps, { assistantTier: "extended" });
    const pkg = await extended.assistantContext.forStudy(users.analystA, study.id);
    expect(pkg.tier).toBe("extended");
    await expect(extended.assistantContext.forStudy(users.viewerA, study.id)).rejects.toSatisfy(code("NOT_FOUND"));
  });
});

describe("study context: data tiers and notes", () => {
  it("never includes private notes at the standard tier, and says why", async () => {
    const s = setup();
    const study = await richStudy(s);
    await s.services.studies.addNote(users.analystA, study.id, "Our private thesis");
    const pkg = await s.services.assistantContext.forStudy(users.analystA, study.id);
    expect(pkg.items.some((i) => i.kind === "firm_note")).toBe(false);
    expect(JSON.stringify(pkg)).not.toContain("Our private thesis");
    expect(pkg.omitted).toContainEqual(expect.objectContaining({ kind: "firm_note", reason: expect.stringMatching(/aren't approved/) }));
  });

  it("includes notes at the extended tier for the owning firm only", async () => {
    const s = setup();
    const study = await richStudy(s, "PUBLIC");
    await s.services.studies.addNote(users.analystA, study.id, "Our private thesis");
    const extended = createVcServices(s.deps, { assistantTier: "extended" });
    const mine = await extended.assistantContext.forStudy(users.analystA, study.id);
    expect(mine.items.filter((i) => i.kind === "firm_note").map((i) => i.value)).toEqual(["Our private thesis"]);
    // Another firm can view the published PUBLIC study, but never its notes.
    const theirs = await extended.assistantContext.forStudy(users.analystB, study.id);
    expect(JSON.stringify(theirs)).not.toContain("Our private thesis");
  });

  it("leaves out facts and news about unpublished startups", async () => {
    const s = setup();
    const study = await richStudy(s);
    s.platform.state.startups.find((x) => x.id === "startup_1")!.isPublished = false;
    const pkg = await s.services.assistantContext.forStudy(users.analystA, study.id);
    expect(pkg.items.some((i) => i.id.startsWith("fact:") || i.id.startsWith("news:"))).toBe(false);
  });
});

describe("study context: items", () => {
  it("gives every item a unique namespaced id from real records", async () => {
    const s = setup();
    const study = await richStudy(s);
    const pkg = await s.services.assistantContext.forStudy(users.analystA, study.id);
    const ids = pkg.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^(study|market|snapshot|source|fact|news|indicator|startup|note|flag):/.test(id))).toBe(true);
    expect(ids).toEqual(
      expect.arrayContaining([
        `study:${study.id}#question`,
        `study:${study.id}#criteria-yes`,
        `market:${study.marketId}#current`,
        `market:${study.marketId}#baseline`,
        "snapshot:snap_first",
        "snapshot:snap_week",
        "snapshot:snap_last",
        "fact:f1",
        "news:n1",
        "startup:startup_1",
      ]),
    );
    // Only the three key snapshots; the rest are counted as omitted.
    expect(ids).not.toContain("snapshot:snap_mid");
    expect(pkg.omitted).toContainEqual(expect.objectContaining({ kind: "community_estimate", count: 1 }));
  });

  it("puts the fixed caveat on every allocation share and baseline", async () => {
    const s = setup();
    const study = await richStudy(s);
    const pkg = await s.services.assistantContext.forStudy(users.analystA, study.id);
    const shares = pkg.items.filter((i) => i.kind === "community_estimate");
    expect(shares.length).toBeGreaterThan(0);
    expect(shares.every((i) => i.caveat === CAVEATS.allocationShare)).toBe(true);
    expect(pkg.items.find((i) => i.kind === "baseline")!.caveat).toBe(CAVEATS.baseline);
    expect(pkg.items.find((i) => i.id === "news:n1")!.caveat).toBe(CAVEATS.newsUnverified);
  });

  it("adds computed conflict flags that point at real items", async () => {
    const s = setup();
    const study = await richStudy(s);
    const pkg = await s.services.assistantContext.forStudy(users.analystA, study.id);
    const flags = pkg.items.filter((i) => i.kind === "conflict_flag").map((i) => i.id.split(":")[1]);
    // +17 pts on 6 forecasters, 23 pts above the 35% baseline, after an unverified report.
    expect(flags).toEqual(expect.arrayContaining(["thin-move", "move-after-unverified-report"]));
    const ids = new Set(pkg.items.map((i) => i.id));
    for (const f of pkg.items.filter((i) => i.kind === "conflict_flag")) {
      expect(f.relatedIds!.every((id) => ids.has(id))).toBe(true);
    }
  });

  it("renders deterministically and round-trips through the citation checker", async () => {
    const s = setup();
    const study = await richStudy(s);
    const pkg = await s.services.assistantContext.forStudy(users.analystA, study.id);
    const text = renderContext(pkg);
    expect(renderContext(pkg)).toBe(text);
    expect(text).toContain(`[[market:${study.marketId}#current]] Community estimate`);
    expect(text).toContain("Not a calibrated probability");

    const answer = `The YES allocation share rose from 41% to 58% over the week [[snapshot:snap_week]][[snapshot:snap_last]]. That followed an unverified report of a utility contract [[news:n1]].`;
    expect(checkCitations(answer, pkg).grounded).toBe(true);
    expect(checkCitations("Revenue tripled [[fact:invented]].", pkg).grounded).toBe(false);
  });
});

describe("comparison context", () => {
  it("drops restricted study questions at the standard tier and recomputes the track record", async () => {
    const s = setup();
    const restricted = await richStudy(s, "RESTRICTED");
    const org = await richStudy(s, "ORGANIZATION");
    const pkg = await s.services.assistantContext.forComparison(users.analystA, ["startup_1", "startup_2"]);
    const ids = pkg.items.map((i) => i.id);
    expect(ids).toContain(`market:${org.marketId}#current`);
    expect(ids).not.toContain(`market:${restricted.marketId}#current`);
    expect(pkg.omitted).toContainEqual(expect.objectContaining({ kind: "restricted_study", count: 1 }));
    expect(ids).toEqual(expect.arrayContaining(["startup:startup_1", "startup:startup_2", "trackrecord:startup_1"]));

    const extended = createVcServices(s.deps, { assistantTier: "extended" });
    const all = await extended.assistantContext.forComparison(users.analystA, ["startup_1", "startup_2"]);
    expect(all.items.map((i) => i.id)).toContain(`market:${restricted.marketId}#current`);
  });

  it("never includes another firm's private study", async () => {
    const s = setup();
    const priv = await richStudy(s, "ORGANIZATION");
    const pkg = await s.services.assistantContext.forComparison(users.analystB, ["startup_1", "startup_2"]);
    expect(pkg.items.map((i) => i.id)).not.toContain(`market:${priv.marketId}#current`);
  });
});
