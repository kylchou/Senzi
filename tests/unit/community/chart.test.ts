import { describe, expect, it } from "vitest";
import { buildGeometry, downsample, nearestIndex, plottable, shareMovement, timeTicks, type ChartBox } from "@/lib/market-view/chart";
import type { HistoryPoint } from "@/lib/market-view/types";

const box: ChartBox = { width: 100, height: 100, padding: { top: 0, right: 0, bottom: 0, left: 0 } };
const day = 86_400_000;
const t0 = Date.parse("2026-10-01T00:00:00Z");
const at = (offsetDays: number) => new Date(t0 + offsetDays * day).toISOString();
const point = (offsetDays: number, share: number | null, calibrated: number | null = null): HistoryPoint => ({
  at: at(offsetDays),
  share,
  calibrated,
  forecasterCount: 1,
});

describe("plottable", () => {
  it("drops null shares and sorts by time", () => {
    const result = plottable([point(2, 0.5), point(0, null), point(1, 0.4)]);
    expect(result.map((p) => p.share)).toEqual([0.4, 0.5]);
  });
});

describe("downsample", () => {
  it("keeps the first and last items", () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const result = downsample(items, 10);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe(0);
    expect(result[9]).toBe(99);
  });

  it("returns small arrays unchanged", () => {
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});

describe("buildGeometry", () => {
  it("returns null without plottable data", () => {
    expect(buildGeometry([], box)).toBeNull();
    expect(buildGeometry([point(0, null)], box)).toBeNull();
  });

  it("maps share to y with 100% at the top", () => {
    const geometry = buildGeometry([point(0, 1), point(10, 0)], box, t0 + 10 * day)!;
    expect(geometry.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(geometry.points[1]).toMatchObject({ x: 100, y: 100 });
  });

  it("builds a step path that extends to now", () => {
    const geometry = buildGeometry([point(0, 0.5), point(5, 0.25)], box, t0 + 10 * day)!;
    expect(geometry.path).toBe("M0.0,50.0H50.0V75.0H100.0");
    expect(geometry.calibratedPath).toBeNull();
  });

  it("draws the calibrated probability as its own path", () => {
    const geometry = buildGeometry([point(0, 0.5, 0.4), point(5, 0.25, 0.3)], box, t0 + 10 * day)!;
    expect(geometry.calibratedPath).toBe("M0.0,60.0H50.0V70.0H100.0");
    expect(geometry.path).toBe("M0.0,50.0H50.0V75.0H100.0");
  });
});

describe("nearestIndex", () => {
  const points = [0, 25, 50, 75].map((x) => ({ x, y: 0, point: { at: "", share: 0, calibrated: null, forecasterCount: 0 } }));

  it("returns the point at or before x", () => {
    expect(nearestIndex(points, -5)).toBe(0);
    expect(nearestIndex(points, 30)).toBe(1);
    expect(nearestIndex(points, 50)).toBe(2);
    expect(nearestIndex(points, 999)).toBe(3);
  });
});

describe("timeTicks", () => {
  it("spaces ticks evenly", () => {
    expect(timeTicks(0, 30, 4)).toEqual([0, 10, 20, 30]);
    expect(timeTicks(5, 5)).toEqual([5]);
  });
});

describe("shareMovement", () => {
  it("compares the latest share with the snapshot from the window start", () => {
    const history = [point(0, 0.3), point(2, 0.4), point(9, 0.55)];
    const movement = shareMovement(history, 7, t0 + 9 * day)!;
    expect(movement.from).toBe(0.4);
    expect(movement.to).toBe(0.55);
    expect(movement.delta).toBeCloseTo(0.15);
    expect(movement.days).toBe(7);
  });

  it("uses the actual span when history is shorter than the window", () => {
    const movement = shareMovement([point(0, 0.5), point(3, 0.6)], 7, t0 + 3 * day)!;
    expect(movement.days).toBe(3);
    expect(movement.delta).toBeCloseTo(0.1);
  });

  it("returns null with fewer than two points", () => {
    expect(shareMovement([point(0, 0.5)], 7)).toBeNull();
    expect(shareMovement([point(0, null), point(1, 0.5)], 7)).toBeNull();
  });
});
