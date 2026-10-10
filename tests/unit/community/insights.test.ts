import { describe, expect, it } from "vitest";
import { eventImpact, rankMoves, shareAt, timelineSteps } from "@/lib/market-view/insights";
import type { HistoryPoint, MarketDetail, MarketSummary } from "@/lib/market-view/types";

const DAY = 86_400_000;
const t0 = Date.parse("2026-10-01T00:00:00Z");
const at = (d: number) => new Date(t0 + d * DAY).toISOString();
const point = (d: number, share: number | null): HistoryPoint => ({ at: at(d), share, calibrated: null, forecasterCount: 1 });
const history = [point(0, 0.3), point(2, 0.35), point(5, 0.5), point(9, 0.45)];

describe("shareAt", () => {
  it("returns the share in effect at a time", () => {
    expect(shareAt(history, t0 - DAY)).toBeNull();
    expect(shareAt(history, t0 + 3 * DAY)).toBe(0.35);
    expect(shareAt(history, t0 + 9 * DAY)).toBe(0.45);
  });
});

describe("eventImpact", () => {
  it("compares the share before an event with the share a few days later", () => {
    const impact = eventImpact(history, at(3), t0 + 20 * DAY, 3)!;
    expect(impact.before).toBe(0.35);
    expect(impact.after).toBe(0.5);
    expect(impact.delta).toBeCloseTo(0.15);
  });

  it("stops at the end of the chart", () => {
    expect(eventImpact(history, at(3), t0 + 4 * DAY, 3)?.after).toBe(0.35);
  });

  it("is null before any history", () => {
    expect(eventImpact(history, at(-5), t0 + 20 * DAY)).toBeNull();
  });
});

const summary = (id: string, share: number | null): MarketSummary => ({
  id,
  slug: id,
  question: id,
  status: "OPEN",
  closesAt: at(30),
  verifiedUsersOnly: false,
  startup: { slug: "s", name: "S", industry: "AI", logoUrl: null },
  openingBaseline: 0.5,
  probability: share,
  allocation: { share, yesCredits: 0, noCredits: 0, forecastCount: 0 },
  calibratedProbability: null,
  forecasterCount: null,
  updatedAt: null,
  outcome: null,
  resolvedAt: null,
});

describe("rankMoves", () => {
  it("orders by absolute change and drops tiny or unknown moves", () => {
    const moves = rankMoves(
      [
        { market: summary("a", 0.6), from: 0.5 },
        { market: summary("b", 0.2), from: 0.5 },
        { market: summary("c", 0.505), from: 0.5 },
        { market: summary("d", null), from: 0.5 },
        { market: summary("e", 0.4), from: null },
      ],
      5,
    );
    expect(moves.map((move) => move.market.id)).toEqual(["b", "a"]);
    expect(moves[0].delta).toBeCloseTo(-0.3);
  });
});

const detail = (overrides: Partial<MarketDetail>): MarketDetail => ({
  ...summary("m", 0.5),
  description: null,
  yesCriteria: "",
  noCriteria: "",
  baselineMethodology: null,
  baselineSetAt: at(0),
  category: null,
  opensAt: at(0),
  resolvesBy: at(40),
  sources: [],
  resolution: null,
  coverage: [],
  startup: { slug: "s", name: "S", industry: "AI", logoUrl: null, tagline: "", websiteUrl: null },
  ...overrides,
});

describe("timelineSteps", () => {
  it("marks the deadline as current while a market is open", () => {
    const steps = timelineSteps(detail({}), t0 + 5 * DAY);
    expect(steps.map((step) => [step.key, step.state])).toEqual([
      ["opened", "done"],
      ["baseline", "done"],
      ["closes", "current"],
      ["resolved", "upcoming"],
      ["settled", "upcoming"],
    ]);
  });

  it("moves to resolution after the deadline", () => {
    const steps = timelineSteps(detail({}), t0 + 35 * DAY);
    expect(steps.find((step) => step.key === "closes")?.state).toBe("done");
    expect(steps.find((step) => step.key === "resolved")?.state).toBe("current");
  });

  it("shows outcome and pending settlement once resolved", () => {
    const steps = timelineSteps(
      detail({
        status: "RESOLVED",
        resolution: {
          outcome: "VOID",
          evidenceSummary: "",
          evidenceUrls: [],
          resolvedAt: at(32),
          settlementStatus: "PENDING",
          settledAt: null,
        },
      }),
      t0 + 35 * DAY,
    );
    expect(steps.find((step) => step.key === "resolved")?.label).toBe("Resolved as void");
    expect(steps.find((step) => step.key === "settled")).toMatchObject({ label: "Settlement", state: "current" });
  });

  it("skips the baseline step when no baseline was set", () => {
    expect(timelineSteps(detail({ openingBaseline: null }), t0).some((step) => step.key === "baseline")).toBe(false);
  });
});

describe("groupStartupMarkets", () => {
  it("orders open by deadline and resolved by most recent", async () => {
    const { groupStartupMarkets } = await import("@/lib/market-view/insights");
    const make = (id: string, status: MarketSummary["status"], closes: number, resolved?: number): MarketSummary => ({
      ...summary(id, 0.5),
      status,
      closesAt: at(closes),
      resolvedAt: resolved === undefined ? null : at(resolved),
    });
    const groups = groupStartupMarkets([
      make("late", "OPEN", 40),
      make("soon", "OPEN", 10),
      make("waiting", "CLOSED", 5),
      make("old", "RESOLVED", 1, 2),
      make("recent", "RESOLVED", 3, 8),
      make("void", "CANCELLED", 4),
    ]);
    expect(groups.open.map((m) => m.id)).toEqual(["soon", "late"]);
    expect(groups.awaiting.map((m) => m.id)).toEqual(["waiting"]);
    expect(groups.resolved.map((m) => m.id)).toEqual(["recent", "void", "old"]);
  });
});
