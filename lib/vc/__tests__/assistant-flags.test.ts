import { describe, expect, it } from "vitest";
import { computeConflictFlags, type FlagInput } from "../assistant/flags";

const NOW = new Date("2026-10-10T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

function input(over: Partial<FlagInput> = {}): FlagInput {
  return {
    subjectId: "s1",
    href: "/vc/studies/s1",
    status: "OPEN",
    deadline: new Date(NOW.getTime() + 60 * DAY),
    now: NOW,
    current: { id: "market:m1#current", share: 0.5, forecasters: 20, totalCredits: 1000 },
    baseline: { id: "market:m1#baseline", value: 0.45 },
    calibrated: null,
    change7d: null,
    facts: [{ id: "fact:f1", verified: true, asOf: daysAgo(10) }],
    news: [],
    sources: [],
    ...over,
  };
}
const keys = (i: FlagInput) => computeConflictFlags(i).map((f) => f.id.split(":")[1]);

describe("conflict flags", () => {
  it("raises nothing for a healthy, well-evidenced question", () => {
    expect(keys(input())).toEqual([]);
  });

  it("flags a big move on few forecasters and links both snapshots", () => {
    const flags = computeConflictFlags(
      input({
        current: { id: "market:m1#current", share: 0.58, forecasters: 6, totalCredits: 600 },
        change7d: { value: 0.17, fromId: "snapshot:a", toId: "snapshot:b" },
      }),
    );
    const thin = flags.find((f) => f.id === "flag:thin-move:s1")!;
    expect(thin.value).toMatch(/\+17\.0 pts in 7 days with only 6 forecasters/);
    expect(thin.relatedIds).toEqual(["snapshot:a", "snapshot:b", "market:m1#current"]);
    expect(thin.kind).toBe("conflict_flag");
  });

  it("does not flag the same move when participation is broad", () => {
    expect(keys(input({ change7d: { value: 0.17, fromId: null, toId: null } }))).not.toContain("thin-move");
  });

  it("flags a large gap from the opening baseline only with enough forecasters", () => {
    expect(keys(input({ baseline: { id: "b", value: 0.2 } }))).toContain("baseline-gap");
    expect(
      keys(input({ baseline: { id: "b", value: 0.2 }, current: { id: "c", share: 0.5, forecasters: 2, totalCredits: 10 } })),
    ).not.toContain("baseline-gap");
  });

  it("flags disagreement between the calibrated probability and the share", () => {
    expect(keys(input({ calibrated: { id: "cal", value: 0.3 } }))).toContain("calibration-gap");
    expect(keys(input({ calibrated: { id: "cal", value: 0.45 } }))).not.toContain("calibration-gap");
  });

  it("flags open questions with no credits", () => {
    expect(keys(input({ current: { id: "c", share: null, forecasters: 0, totalCredits: 0 } }))).toContain("no-participation");
  });

  it("flags disputed news, and evidence that is all unverified", () => {
    const k = keys(
      input({
        facts: [{ id: "fact:f1", verified: false, asOf: daysAgo(3) }],
        news: [{ id: "news:n1", verification: "DISPUTED", publishedAt: daysAgo(2) }],
      }),
    );
    expect(k).toContain("disputed-news");
    expect(k).toContain("unverified-only");
  });

  it("flags a big move that follows an unverified report in the same week", () => {
    const flags = computeConflictFlags(
      input({
        change7d: { value: 0.17, fromId: "snapshot:a", toId: "snapshot:b" },
        news: [{ id: "news:n1", verification: "UNVERIFIED", publishedAt: daysAgo(3) }],
      }),
    );
    const f = flags.find((x) => x.id === "flag:move-after-unverified-report:s1")!;
    expect(f.relatedIds).toEqual(expect.arrayContaining(["snapshot:b", "news:n1"]));
    // An older report doesn't count.
    expect(
      keys(input({ change7d: { value: 0.17, fromId: null, toId: null }, news: [{ id: "news:n1", verification: "UNVERIFIED", publishedAt: daysAgo(30) }] })),
    ).not.toContain("move-after-unverified-report");
  });

  it("flags stale or undated evidence on open questions only", () => {
    expect(keys(input({ facts: [{ id: "fact:f1", verified: true, asOf: daysAgo(400) }] }))).toContain("stale-evidence");
    expect(keys(input({ facts: [] }))).toContain("stale-evidence");
    expect(keys(input({ status: "RESOLVED", facts: [] }))).not.toContain("stale-evidence");
  });

  it("flags a near deadline with almost no forecasters", () => {
    expect(
      keys(input({ deadline: new Date(NOW.getTime() + 5 * DAY), current: { id: "c", share: 0.5, forecasters: 1, totalCredits: 100 } })),
    ).toContain("deadline-thin");
  });
});
