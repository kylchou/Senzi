import { describe, expect, it } from "vitest";
import {
  describeFreshness,
  downsample,
  formatPointChange,
  formatShare,
  resolveBaseline,
  shareChangeOverWindow,
} from "../estimates";
import { makeEstimate } from "../testing/memory";
import { createStudyInput, transitionInput, updateStudyInput, watchlistItemInput } from "../validation";
import { DAY, NOW, validStudyInput } from "./fixtures";

describe("validation", () => {
  it("accepts a valid study and coerces dates", () => {
    const parsed = createStudyInput.parse({ ...validStudyInput(), deadline: "2027-01-01T00:00:00Z" });
    expect(parsed.deadline).toBeInstanceOf(Date);
  });

  it("requires YES/NO phrasing, and drops any baseline typed by the client", () => {
    expect(createStudyInput.safeParse({ ...validStudyInput(), question: "Acme raises a Series B soon" }).success).toBe(false);
    const typed = createStudyInput.parse({ ...validStudyInput(), baselineValue: 0.9, baselineMethodology: "Gut feeling" });
    expect(typed).not.toHaveProperty("baselineValue");
    expect(typed).not.toHaveProperty("baselineMethodology");
  });

  it("checks the model link: real dates and a positive threshold; firm figures are never taken from the payload", () => {
    const link = validStudyInput().modelLink!;
    const parse = (modelLink: object) => createStudyInput.safeParse({ ...validStudyInput(), modelLink }).success;
    expect(parse(link)).toBe(true);
    expect(parse({ ...link, targetDate: "2027-02-30" })).toBe(false);
    expect(parse({ ...link, threshold: 0 })).toBe(false);
    const parsed = createStudyInput.parse({ ...validStudyInput(), modelLink: { ...link, observations: [{ metricId: "x", value: 1 }] } });
    expect(parsed.modelLink).not.toHaveProperty("observations");
    expect(createStudyInput.safeParse({ ...validStudyInput(), modelLink: null }).success).toBe(true);
  });

  it("rejects non-http source links", () => {
    const bad = { ...validStudyInput(), sources: [{ url: "javascript:alert(1)", title: "x" }] };
    expect(createStudyInput.safeParse(bad).success).toBe(false);
  });

  it("does not accept the system-only resolve action from clients", () => {
    expect(transitionInput.safeParse({ action: "resolve", expectedVersion: 1 }).success).toBe(false);
  });

  it("leaves omitted fields undefined on update", () => {
    const parsed = updateStudyInput.parse({ expectedVersion: 2, context: "x" });
    expect(parsed.sources).toBeUndefined();
    expect(parsed.question).toBeUndefined();
  });

  it("discriminates watchlist items", () => {
    expect(watchlistItemInput.safeParse({ type: "STUDY", startupId: "x" }).success).toBe(false);
    expect(watchlistItemInput.safeParse({ type: "STARTUP", startupId: "x" }).success).toBe(true);
  });
});

describe("estimate helpers", () => {
  it("formats shares and point changes", () => {
    expect(formatShare(null)).toBe("—");
    expect(formatShare(0.456, 1)).toBe("45.6%");
    expect(formatPointChange(0.123)).toBe("+12.3 pts");
    expect(formatPointChange(-0.05)).toBe("−5.0 pts");
  });

  it("computes window change only when an earlier point exists", () => {
    const points = [
      { at: new Date(NOW.getTime() - 2 * DAY), yesShare: 0.4, totalCredits: 1, participantCount: 1 },
      { at: new Date(NOW.getTime() - 1000), yesShare: 0.5, totalCredits: 1, participantCount: 1 },
    ];
    expect(shareChangeOverWindow(points, DAY, NOW)).toBeCloseTo(0.1);
    expect(shareChangeOverWindow(points.slice(1), DAY, NOW)).toBeNull();
  });

  it("prefers the market baseline over the study proposal", () => {
    const s = { baselineValue: 0.2, baselineMethodology: "Study" };
    expect(resolveBaseline(s, null)).toEqual({ value: 0.2, methodology: "Study", source: "study" });
    expect(resolveBaseline(s, makeEstimate("m")).source).toBe("market");
    expect(resolveBaseline({ baselineValue: null, baselineMethodology: null }, null).source).toBeNull();
  });

  it("flags stale estimates on open studies only", () => {
    const old = makeEstimate("m", { asOf: new Date(NOW.getTime() - 2 * DAY) });
    expect(describeFreshness(old, "OPEN", NOW).isStale).toBe(true);
    expect(describeFreshness(old, "RESOLVED", NOW).isStale).toBe(false);
  });

  it("downsamples while keeping endpoints", () => {
    const arr = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsample(arr, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[9]).toBe(999);
  });
});
