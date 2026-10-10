import { describe, expect, it } from "vitest";
import {
  formatDeadline,
  formatPointChange,
  formatRelative,
  formatShare,
  formatStage,
  isPastDeadline,
} from "@/lib/market-view/format";

const now = new Date("2026-10-09T12:00:00Z");

describe("formatShare", () => {
  it("formats shares as whole percentages", () => {
    expect(formatShare(0.624)).toBe("62%");
    expect(formatShare(0)).toBe("0%");
    expect(formatShare(1)).toBe("100%");
  });

  it("shows N/A for missing values", () => {
    expect(formatShare(null)).toBe("N/A");
    expect(formatShare(undefined)).toBe("N/A");
    expect(formatShare(Number.NaN)).toBe("N/A");
  });
});

describe("formatPointChange", () => {
  it("signs point changes", () => {
    expect(formatPointChange(0.04)).toBe("+4 pts");
    expect(formatPointChange(-0.121)).toBe("-12 pts");
    expect(formatPointChange(0.001)).toBe("0 pts");
  });
});

describe("formatDeadline", () => {
  it("describes future deadlines", () => {
    expect(formatDeadline("2026-10-12T12:00:00Z", now)).toBe("Closes in 3 days");
    expect(formatDeadline("2026-10-09T17:00:00Z", now)).toBe("Closes in 5 hours");
    expect(formatDeadline("2026-10-09T12:20:00Z", now)).toBe("Closes in under an hour");
    expect(formatDeadline("2026-10-10T12:00:00Z", now)).toBe("Closes in 1 day");
  });

  it("describes past deadlines", () => {
    expect(formatDeadline("2026-10-07T12:00:00Z", now)).toBe("Closed 2 days ago");
  });
});

describe("formatRelative", () => {
  it("uses short relative labels", () => {
    expect(formatRelative("2026-10-09T11:30:00Z", now)).toBe("just now");
    expect(formatRelative("2026-10-09T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelative("2026-10-04T12:00:00Z", now)).toBe("5d ago");
    expect(formatRelative("2026-01-04T12:00:00Z", now)).toBe("Jan 4, 2026");
  });
});

describe("isPastDeadline", () => {
  it("treats the exact deadline as past", () => {
    expect(isPastDeadline("2026-10-09T12:00:00Z", now)).toBe(true);
    expect(isPastDeadline("2026-10-09T12:00:01Z", now)).toBe(false);
  });
});

describe("formatStage", () => {
  it("labels startup stages", () => {
    expect(formatStage("SERIES_B")).toBe("Series B");
    expect(formatStage("PRE_SEED")).toBe("Pre-seed");
    expect(formatStage("SHUT_DOWN")).toBe("Shut down");
  });
});
