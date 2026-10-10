import { describe, expect, it } from "vitest";
import { sparklinePoints } from "@/components/ui/CardSparkline";
import { initials, tintIndex } from "@/components/ui/StartupMark";

describe("initials", () => {
  it("uses up to two words", () => {
    expect(initials("Northwind Robotics")).toBe("NR");
    expect(initials("acme")).toBe("A");
    expect(initials("  Lumen  Grid Storage ")).toBe("LG");
  });
});

describe("tintIndex", () => {
  it("is stable for a name and spreads names across tints", () => {
    expect(tintIndex("Ledgerline")).toBe(tintIndex("Ledgerline"));
    const names = ["Acme", "Lumen Grid", "Cobalt Health", "Quayside", "Harborview", "Tessellate", "Brightside", "Kindred"];
    expect(new Set(names.map(tintIndex)).size).toBeGreaterThan(2);
  });
});

describe("sparklinePoints", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day)).toISOString();

  it("maps time to x and share to y within the box", () => {
    const points = sparklinePoints(
      [
        { at: at(1), share: 0, calibrated: null, forecasterCount: 1 },
        { at: at(3), share: 1, calibrated: null, forecasterCount: 2 },
      ],
      64,
      22,
    );
    expect(points).toBe("0.0,22.0 64.0,0.0");
  });

  it("needs at least two points with a share", () => {
    expect(sparklinePoints([{ at: at(1), share: 0.5, calibrated: null, forecasterCount: 1 }], 64, 22)).toBeNull();
    expect(sparklinePoints([], 64, 22)).toBeNull();
  });
});
