import { describe, expect, it } from "vitest";
import { markerLanes } from "@/components/ui/replay/ReplayTimeline";
import {
  availability,
  biggestDivergence,
  biggestMove,
  canReplay,
  clean,
  compareMoments,
  derivedEvents,
  indexAt,
  normalizePoints,
  playbackMap,
  recentActivity,
  stateAt,
  stepTarget,
  widestGap,
  type ReplayPoint,
} from "@/lib/market-view/replay";

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 9, 1);
const p = (day: number, model: number | null, general: number | null, verified: number | null): ReplayPoint => ({
  at: t0 + day * DAY,
  model,
  general,
  verified,
  forecasts: day,
  credits: day * 100,
});

const history = normalizePoints([
  p(0, 0.5, 0.5, null),
  p(2, null, 0.52, 0.55),
  p(5, 0.53, 0.6, 0.7),
  p(7, null, 0.66, 0.81),
  p(9, 0.57, 0.67, 0.8),
]);

describe("normalizePoints", () => {
  it("sorts and carries each signal forward from its last value", () => {
    const shuffled = normalizePoints([p(2, null, 0.4, null), p(0, 0.5, 0.3, null)]);
    expect(shuffled.map((point) => point.at)).toEqual([t0, t0 + 2 * DAY]);
    expect(shuffled[1].model).toBe(0.5);
    expect(shuffled[1].verified).toBeNull();
  });

  it("drops invalid values instead of passing NaN through", () => {
    expect(clean(Number.NaN)).toBeNull();
    expect(clean(1.4)).toBeNull();
    expect(normalizePoints([p(0, Number.NaN, 2, -1)])[0]).toMatchObject({ model: null, general: null, verified: null });
  });
});

describe("availability and canReplay", () => {
  it("reports which signals have any history", () => {
    expect(availability(history)).toEqual({ model: true, general: true, verified: true });
    expect(availability([p(0, null, 0.5, null)])).toEqual({ model: false, general: true, verified: false });
  });

  it("needs two moments with data", () => {
    expect(canReplay([])).toBe(false);
    expect(canReplay([p(0, 0.5, null, null)])).toBe(false);
    expect(canReplay([p(0, null, null, null), p(1, null, null, null)])).toBe(false);
    expect(canReplay(history)).toBe(true);
  });
});

describe("stateAt", () => {
  it("returns the values in effect at a moment", () => {
    expect(indexAt(history, t0 - 1)).toBe(-1);
    expect(stateAt(history, t0 + 6 * DAY)).toMatchObject({ model: 0.53, general: 0.6, verified: 0.7 });
    expect(stateAt(history, t0 + 7 * DAY)?.verified).toBe(0.81);
  });
});

describe("biggestMove", () => {
  it("finds the largest change in one signal over the window", () => {
    const move = biggestMove(history, 3)!;
    expect(move.series).toBe("verified");
    // Day 7 (0.81) against the value three days earlier (day 4, carried from day 2: 0.55).
    expect(move.at).toBe(t0 + 7 * DAY);
    expect(move.delta).toBeCloseTo(0.26);
  });

  it("is null when nothing moved meaningfully", () => {
    expect(biggestMove(normalizePoints([p(0, 0.5, 0.5, 0.5), p(1, 0.505, 0.5, 0.5)]))).toBeNull();
  });
});

describe("biggestDivergence", () => {
  it("finds the widest gap between any two signals", () => {
    const divergence = biggestDivergence(history)!;
    expect(divergence.at).toBe(t0 + 7 * DAY);
    expect([divergence.a, divergence.b].sort()).toEqual(["model", "verified"]);
    expect(divergence.gap).toBeCloseTo(0.28);
  });

  it("needs two signals at the same moment", () => {
    expect(biggestDivergence(normalizePoints([p(0, null, 0.5, null), p(1, null, 0.7, null)]))).toBeNull();
    expect(widestGap(p(0, 0.5, null, null))).toBeNull();
  });
});

describe("compareMoments", () => {
  it("reports each signal's change and how gaps moved, largest first", () => {
    const result = compareMoments(history, t0 + 5 * DAY, t0 + 9 * DAY);
    expect(result.rows[0]).toMatchObject({ series: "verified" });
    expect(result.rows.find((row) => row.series === "model")?.delta).toBeCloseTo(0.04);
    expect(result.rows.find((row) => row.series === "general")?.delta).toBeCloseTo(0.07);
    const verifiedVsModel = result.gaps.find((gap) => gap.a === "verified" && gap.b === "model")!;
    expect(verifiedVsModel.from).toBeCloseTo(0.17);
    expect(verifiedVsModel.to).toBeCloseTo(0.23);
    expect(verifiedVsModel.delta).toBeCloseTo(0.06);
  });

  it("leaves deltas empty when a signal is missing at one moment", () => {
    const result = compareMoments(history, t0, t0 + 9 * DAY);
    expect(result.rows.find((row) => row.series === "verified")?.delta).toBeNull();
  });
});

describe("derivedEvents", () => {
  it("flags sharp moves and the first split between signals", () => {
    const events = derivedEvents(history, 0.1, 0.15, 3);
    expect(events.some((event) => event.kind === "move" && event.title.startsWith("Verified Users +"))).toBe(true);
    const split = events.find((event) => event.kind === "divergence")!;
    expect(split.origin).toBe("derived");
    expect(split.at).toBe(t0 + 5 * DAY);
  });

  it("finds nothing in a flat history", () => {
    expect(derivedEvents(normalizePoints([p(0, 0.5, 0.5, 0.5), p(5, 0.5, 0.51, 0.5)]))).toEqual([]);
  });
});

describe("playbackMap", () => {
  const start = t0;
  const end = t0 + 100 * DAY;
  const map = playbackMap([t0 + 1 * DAY, t0 + 2 * DAY, t0 + 98 * DAY], start, end);

  it("starts and ends on the real bounds and never moves backward", () => {
    expect(map.timeAt(0)).toBe(start);
    expect(map.timeAt(1)).toBe(end);
    let last = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const time = map.timeAt(i / 100);
      expect(time).toBeGreaterThanOrEqual(last);
      last = time;
    }
  });

  it("spends less playback time on the long quiet stretch", () => {
    const quietShare = map.progressAt(t0 + 98 * DAY) - map.progressAt(t0 + 2 * DAY);
    expect(quietShare).toBeLessThan(0.96);
  });

  it("round-trips between time and progress", () => {
    const time = t0 + 40 * DAY;
    expect(map.timeAt(map.progressAt(time))).toBeCloseTo(time, -2);
  });
});

describe("stepTarget", () => {
  const stops = [10, 20, 30];
  it("moves to the next or previous stop", () => {
    expect(stepTarget(stops, 20, 1)).toBe(30);
    expect(stepTarget(stops, 20, -1)).toBe(10);
    expect(stepTarget(stops, 30, 1)).toBeNull();
    expect(stepTarget(stops, 10, -1)).toBeNull();
  });
});

describe("recentActivity", () => {
  it("sums buckets in the trailing window", () => {
    const buckets = [
      { start: t0, end: t0 + DAY, yes: 3, no: 1, yesCredits: 300, noCredits: 50, verified: 1 },
      { start: t0 + DAY, end: t0 + 2 * DAY, yes: 2, no: 4, yesCredits: 100, noCredits: 200, verified: 0 },
    ];
    expect(recentActivity(buckets, t0 + DAY + 1, DAY)).toMatchObject({ yes: 2, no: 4 });
    expect(recentActivity(buckets, t0 + DAY + 1, 2 * DAY)).toMatchObject({ yes: 5, no: 5, verified: 1 });
    expect(recentActivity(null, t0)).toBeNull();
  });
});

describe("markerLanes", () => {
  it("stacks markers that would overlap and reuses free lanes", () => {
    expect(markerLanes([10, 11, 30, 31, 32])).toEqual([0, 1, 0, 1, 2]);
    expect(markerLanes([10, 20, 30])).toEqual([0, 0, 0]);
  });
});
