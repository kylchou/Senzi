import { describe, expect, it } from "vitest";
import {
  areaPath,
  availableRanges,
  buildGeometry,
  downsample,
  nearestIndex,
  plottable,
  shareMovement,
  sliceHistory,
  smoothPath,
  timeTicks,
  type ChartBox,
} from "@/lib/market-view/chart";
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

  it("draws a continuous line between snapshots that holds flat until now", () => {
    const geometry = buildGeometry([point(0, 0.5), point(5, 0.25)], box, t0 + 10 * day)!;
    expect(geometry.path).toBe("M0.0,50.0C16.7,58.3 33.3,66.7 50.0,75.0H100.0");
    expect(geometry.calibratedPath).toBeNull();
  });

  it("draws the calibrated probability as its own path", () => {
    const geometry = buildGeometry([point(0, 0.5, 0.4), point(5, 0.25, 0.3)], box, t0 + 10 * day)!;
    expect(geometry.calibratedPath).toBe("M0.0,60.0C16.7,63.3 33.3,66.7 50.0,70.0H100.0");
  });
});

describe("smoothPath", () => {
  const numbers = (path: string) => [...path.matchAll(/-?\d+\.\d/g)].map((match) => Number(match[0]));

  it("never overshoots: a flat stretch after a jump stays flat", () => {
    const path = smoothPath(
      [
        { x: 0, y: 80 },
        { x: 10, y: 20 },
        { x: 40, y: 20 },
        { x: 60, y: 50 },
      ],
      100,
    );
    expect(path.startsWith("M0.0,80.0C")).toBe(true);
    // Every control point stays inside the range of the values it connects.
    const ys = numbers(path.replace(/H[\d.]+$/, "")).filter((_, index) => index % 2 === 1);
    expect(ys.length).toBe(10);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...ys)).toBeLessThanOrEqual(80);
    // The segment between the two equal values is a straight horizontal line.
    expect(path).toContain("C20.0,20.0 30.0,20.0 40.0,20.0");
    expect(path.endsWith("H100.0")).toBe(true);
  });

  it("handles one point and repeated timestamps", () => {
    expect(smoothPath([{ x: 0, y: 40 }], 100)).toBe("M0.0,40.0H100.0");
    expect(
      smoothPath(
        [
          { x: 0, y: 40 },
          { x: 0, y: 60 },
        ],
        100,
      ),
    ).toBe("M0.0,60.0H100.0");
  });
});

describe("nearestIndex", () => {
  const points = [0, 25, 50, 75].map((x) => ({ x, y: 0, point: { at: "", share: 0, calibrated: null, forecasterCount: 0 } }));

  it("returns the closest recorded point", () => {
    expect(nearestIndex(points, -5)).toBe(0);
    expect(nearestIndex(points, 30)).toBe(1);
    expect(nearestIndex(points, 40)).toBe(2);
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

describe("sliceHistory", () => {
  const history = [point(0, 0.2), point(5, 0.4), point(20, 0.6), point(28, 0.7)];
  const end = t0 + 30 * day;

  it("keeps everything for All", () => {
    expect(sliceHistory(history, null, end)).toBe(history);
  });

  it("carries the last earlier value to the window start", () => {
    const sliced = sliceHistory(history, 7, end);
    expect(sliced.map((p) => p.share)).toEqual([0.6, 0.7]);
    expect(sliced[0].at).toBe(at(23));
  });

  it("returns only points inside when nothing came before", () => {
    expect(sliceHistory([point(29, 0.5)], 7, end).map((p) => p.share)).toEqual([0.5]);
  });
});

describe("availableRanges", () => {
  it("offers only ranges shorter than the history", () => {
    expect(availableRanges([point(0, 0.5)], t0 + 3 * day)).toEqual([]);
    expect(availableRanges([point(0, 0.5)], t0 + 10 * day)).toEqual(["7d", "all"]);
    expect(availableRanges([point(0, 0.5)], t0 + 60 * day)).toEqual(["7d", "30d", "all"]);
    expect(availableRanges([], t0)).toEqual([]);
  });
});

describe("areaPath", () => {
  it("closes the line down to the baseline", () => {
    expect(areaPath("M0,50H100", 100, 0)).toBe("M0,50H100V100.0H0.0Z");
  });
});
