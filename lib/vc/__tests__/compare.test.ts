import { describe, expect, it } from "vitest";
import { computeTrackRecord, parseCompareIds, toCompareQuestion } from "../compare";
import { VcError } from "../errors";
import { makeEstimate } from "../testing/memory";
import type { CompareQuestion } from "../types";
import { openStudy, setup, users } from "./fixtures";

const q = (outcome: CompareQuestion["outcome"], baseline: number | null, share: number | null): CompareQuestion => ({
  marketId: Math.random().toString(36),
  question: "Q?",
  kind: "market",
  studyId: null,
  href: null,
  status: "RESOLVED",
  closesAt: null,
  openingBaseline: baseline,
  allocationShare: share,
  calibratedProbability: null,
  forecasters: 5,
  forecastCount: 5,
  change7d: null,
  outcome,
});

describe("track record", () => {
  it("scores baseline and allocation share separately and excludes VOID", () => {
    const t = computeTrackRecord([q("YES", 0.5, 0.9), q("NO", 0.5, 0.2), q("VOID", 0.5, 0.5)]);
    expect(t).toMatchObject({ decided: 2, yes: 1, voided: 1, yesRate: 0.5 });
    expect(t.baselineBrier).toBeCloseTo(0.25);
    expect(t.allocationShareBrier).toBeCloseTo((0.01 + 0.04) / 2);
    expect(t.yesRateInterval![0]).toBeLessThan(0.5);
    expect(t.limitations.join(" ")).toMatch(/2 resolved questions/);
    expect(t.limitations.join(" ")).toMatch(/1 voided question is excluded/);
  });

  it("explains an empty record", () => {
    const t = computeTrackRecord([]);
    expect(t.yesRate).toBeNull();
    expect(t.baselineBrier).toBeNull();
    expect(t.limitations[0]).toMatch(/No resolved questions/);
  });

  it("links study questions to the study and plain markets to the public page", () => {
    const m = { id: "m1", slug: "acme-b", question: "Q?", status: "OPEN" as const, closesAt: null };
    expect(toCompareQuestion(m, undefined, null, null).href).toBe("/markets/acme-b");
    expect(toCompareQuestion(m, undefined, { id: "s1" }, null)).toMatchObject({ kind: "study", href: "/vc/studies/s1" });
  });

  it("parses comma-separated ids without duplicates", () => {
    expect(parseCompareIds("a, b,a,,c")).toEqual(["a", "b", "c"]);
    expect(parseCompareIds(undefined)).toEqual([]);
  });
});

describe("compare service", () => {
  it("needs 2–4 published startups", async () => {
    const s = setup();
    await expect(s.services.compare.compare(users.analystA, ["startup_1"])).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "VALIDATION_ERROR",
    );
    s.platform.state.startups.push({ id: "hidden", name: "Hidden", slug: "hidden", industry: null, isPublished: false });
    await expect(s.services.compare.compare(users.analystA, ["startup_1", "hidden"])).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "NOT_FOUND",
    );
    await expect(s.services.compare.compare(users.outsider, ["startup_1", "startup_2"])).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "FORBIDDEN",
    );
  });

  it("shows own and public studies but never another firm's private study", async () => {
    const s = setup();
    const priv = await openStudy(s, { visibility: "ORGANIZATION" });
    const pub = await openStudy(s, { visibility: "PUBLIC" });
    for (const st of [priv, pub]) s.forecasting.estimates.set(st.marketId!, makeEstimate(st.marketId!));

    const mine = await s.services.compare.compare(users.analystA, ["startup_1", "startup_2"]);
    expect(mine.columns[0].open.map((x) => x.studyId).sort()).toEqual([priv.id, pub.id].sort());

    const theirs = await s.services.compare.compare(users.analystB, ["startup_1", "startup_2"]);
    expect(theirs.columns[0].open.map((x) => x.studyId)).toEqual([pub.id]);
    expect(theirs.columns.map((c) => c.startup.id)).toEqual(["startup_1", "startup_2"]);
  });

  it("builds a track record from resolved questions and includes indicators", async () => {
    const s = setup();
    s.platform.state.markets.push(
      { id: "m_yes", slug: "m-yes", startupId: "startup_2", question: "Yes?", status: "RESOLVED", closesAt: null, visibility: "PUBLIC" },
      { id: "m_open", slug: "m-open", startupId: "startup_2", question: "Open?", status: "OPEN", closesAt: null, visibility: "PUBLIC" },
    );
    s.forecasting.estimates.set(
      "m_yes",
      makeEstimate("m_yes", {
        status: "RESOLVED",
        openingBaseline: { value: 0.4, methodology: "Base rate" },
        generalPrice: 0.8,
        allocation: { yesCredits: 80, noCredits: 20, totalCredits: 100, yesShare: 0.8 },
        resolution: { outcome: "YES", resolvedAt: new Date(), evidenceUrls: [], evidenceSummary: "Announced" },
      }),
    );
    s.forecasting.estimates.set("m_open", makeEstimate("m_open"));
    s.indicators.bySlug.set("globex", {
      status: "ok",
      rows: [{ metricId: "gh", label: "GitHub stars", unit: "stars", value: 1200, asOf: "2026-09-30", change4w: 0.1, sourceUrl: null, provenanceLabel: "Scraped", missingReason: null }],
    });

    const c = await s.services.compare.compare(users.analystA, ["startup_1", "startup_2"]);
    const globex = c.columns[1];
    expect(globex.open.map((x) => x.marketId)).toEqual(["m_open"]);
    expect(globex.resolved.map((x) => x.marketId)).toEqual(["m_yes"]);
    expect(globex.trackRecord).toMatchObject({ decided: 1, yes: 1 });
    expect(globex.trackRecord.baselineBrier).toBeCloseTo(0.36);
    expect(globex.trackRecord.allocationShareBrier).toBeCloseTo(0.04);
    expect(globex.indicators.rows[0].label).toBe("GitHub stars");
    expect(c.columns[0].indicators.status).toBe("not_tracked");
    expect(c.limitations.join(" ")).toMatch(/not investment advice/i);
  });
});
