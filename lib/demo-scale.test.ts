import { afterEach, describe, expect, it, vi } from "vitest";
import { demoCount, demoScaleFactor } from "./demo-scale";

afterEach(() => vi.unstubAllEnvs());

describe("demo display scaling", () => {
  it("gives each market one stable factor between 18 and 32", () => {
    for (const id of ["m1", "cmv2s2xzf000006jpr5juhjir", "posthog-downloads-2026-10-25"]) {
      const f = demoScaleFactor(id);
      expect(f).toBeGreaterThanOrEqual(18);
      expect(f).toBeLessThanOrEqual(32);
      expect(demoScaleFactor(id)).toBe(f);
    }
  });

  it("scales counts but keeps empty markets empty", () => {
    expect(demoCount(0, "m1")).toBe(0);
    expect(demoCount(50, "m1")).toBe(50 * demoScaleFactor("m1"));
  });

  it("shows real counts when DEMO_INFLATE_COUNTS=false", () => {
    vi.stubEnv("DEMO_INFLATE_COUNTS", "false");
    expect(demoCount(50, "m1")).toBe(50);
  });
});
