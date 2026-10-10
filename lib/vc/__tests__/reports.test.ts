import { describe, expect, it } from "vitest";
import { VcError } from "../errors";
import { buildStudyReport, csvCell, reportToCsv, reportToMarkdown } from "../reports";
import { makeEstimate } from "../testing/memory";
import { NOW, openStudy, setup, users } from "./fixtures";

describe("report content", () => {
  it("keeps baseline, allocation share and calibrated probability distinct", async () => {
    const s = setup();
    const study = await openStudy(s);
    const report = buildStudyReport({
      study,
      organization: { id: "org_a", name: "Alpha Ventures" },
      startup: { id: "startup_1", name: "Acme" },
      estimate: makeEstimate(study.marketId!),
      history: [],
      events: [],
      now: NOW,
    });
    expect(report.baseline).toEqual({ value: 0.3, methodology: "Base rate", source: "market" });
    expect(report.communityEstimate?.yesAllocationShare).toBe(0.6);
    expect(report.communityEstimate?.label).toMatch(/not a calibrated probability/);
    expect(report.calibratedProbability).toBeNull();
    expect(report.uncertainty.join(" ")).toMatch(/No calibrated probability/);
    expect(report.limitations.length).toBeGreaterThan(0);
    expect(report.disclaimer).toMatch(/not .*investment advice/i);

    const md = reportToMarkdown(report);
    expect(md).toContain("## Opening baseline");
    expect(md).toContain("Calibrated probability:** Not available");
  });

  it("flags low participation and empty markets", async () => {
    const s = setup();
    const study = await openStudy(s);
    const report = buildStudyReport({
      study,
      organization: { id: "org_a", name: "A" },
      startup: null,
      estimate: makeEstimate(study.marketId!, {
        participantCount: 0,
        allocation: { yesCredits: 0, noCredits: 0, totalCredits: 0, yesShare: null },
      }),
      history: [],
      events: [],
      now: NOW,
    });
    expect(report.uncertainty.join(" ")).toMatch(/No credits have been allocated/);
    expect(report.uncertainty.join(" ")).toMatch(/Only 0 participants/);
  });

  it("neutralizes spreadsheet formulas in CSV", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
  });

  it("produces a CSV with summary and trend rows", async () => {
    const s = setup();
    const study = await openStudy(s);
    const csv = reportToCsv(
      buildStudyReport({
        study,
        organization: { id: "org_a", name: "A" },
        startup: null,
        estimate: makeEstimate(study.marketId!),
        history: [{ at: NOW, yesShare: 0.6, totalCredits: 1000, participantCount: 12 }],
        events: [],
        now: NOW,
      }),
    );
    expect(csv).toContain("community_yes_allocation_share,0.6");
    expect(csv).toContain("calibrated_probability,not available");
    expect(csv).toContain("2026-10-01T12:00:00.000Z,0.6");
  });
});

describe("report access", () => {
  it("is limited to the owning firm, including saved snapshots", async () => {
    const s = setup();
    const study = await openStudy(s, { visibility: "PUBLIC" });
    s.forecasting.estimates.set(study.marketId!, makeEstimate(study.marketId!));

    await expect(s.services.reports.generate(users.analystB, study.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "FORBIDDEN",
    );
    const saved = await s.services.reports.save(users.analystA, study.id);
    expect(saved.organizationId).toBe("org_a");

    await expect(s.services.reports.get(users.analystB, saved.id)).rejects.toSatisfy(
      (e: unknown) => e instanceof VcError && e.code === "NOT_FOUND",
    );
    expect(await s.services.reports.list(users.analystB)).toEqual([]);
    expect((await s.services.reports.list(users.viewerA)).map((r) => r.id)).toEqual([saved.id]);
    await expect(s.services.reports.save(users.viewerA, study.id)).rejects.toBeInstanceOf(VcError);
  });

  it("hides saved reports when a user loses access to a restricted study", async () => {
    const s = setup();
    const study = await openStudy(s, { visibility: "RESTRICTED" });
    const saved = await s.services.reports.save(users.analystA, study.id);
    expect(await s.services.reports.list(users.viewerA)).toEqual([]);
    await expect(s.services.reports.get(users.viewerA, saved.id)).rejects.toBeInstanceOf(VcError);
  });
});
