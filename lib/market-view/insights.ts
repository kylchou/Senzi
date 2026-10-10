import { plottable } from "./chart";
import type { HistoryPoint, MarketDetail, MarketSummary } from "./types";

const DAY = 86_400_000;

/** The market probability in effect at `time` (last snapshot at or before it), or null. */
export function shareAt(history: HistoryPoint[], time: number): number | null {
  let value: number | null = null;
  for (const point of plottable(history)) {
    if (Date.parse(point.at) > time) break;
    value = point.share;
  }
  return value;
}

/**
 * How the market probability moved around a dated event (for example a news
 * story): the share just before it and `days` later (or at `end` if sooner).
 */
export function eventImpact(
  history: HistoryPoint[],
  at: string,
  end: number,
  days = 3,
): { before: number; after: number; delta: number } | null {
  const time = Date.parse(at);
  const before = shareAt(history, time);
  const after = shareAt(history, Math.min(end, time + days * DAY));
  if (before === null || after === null) return null;
  return { before, after, delta: after - before };
}

export interface MarketMove {
  market: MarketSummary;
  from: number;
  to: number;
  delta: number;
}

/** Largest absolute probability changes first, ignoring moves smaller than `min`. */
export function rankMoves(
  rows: { market: MarketSummary; from: number | null }[],
  limit: number,
  min = 0.01,
): MarketMove[] {
  return rows
    .flatMap(({ market, from }) => {
      const to = market.probability;
      if (from === null || to === null) return [];
      return [{ market, from, to, delta: to - from }];
    })
    .filter((move) => Math.abs(move.delta) >= min)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
}

export type TimelineState = "done" | "current" | "upcoming";

export interface TimelineStep {
  key: string;
  label: string;
  date: string | null;
  detail?: string;
  state: TimelineState;
}

/** Lifecycle of a market from opening to settlement, from fields already on the market. */
export function timelineSteps(market: MarketDetail, now: number): TimelineStep[] {
  const closed = Date.parse(market.closesAt) <= now || market.status !== "OPEN";
  const resolution = market.resolution;
  const steps: TimelineStep[] = [
    { key: "opened", label: "Opened", date: market.opensAt, state: "done" },
  ];
  if (market.openingBaseline !== null) {
    steps.push({ key: "baseline", label: "Baseline set", date: market.baselineSetAt ?? market.opensAt, state: "done" });
  }
  if (market.status === "CANCELLED" && !resolution) {
    steps.push({ key: "cancelled", label: "Cancelled", date: null, state: "done" });
    return steps;
  }
  steps.push({
    key: "closes",
    label: closed ? "Closed to forecasts" : "Closes to forecasts",
    date: market.closesAt,
    state: closed ? "done" : "current",
  });
  steps.push(
    resolution
      ? {
          key: "resolved",
          label: resolution.outcome === "VOID" ? "Resolved as void" : `Resolved ${resolution.outcome}`,
          date: resolution.resolvedAt,
          state: "done",
        }
      : {
          key: "resolved",
          label: "Resolution",
          date: market.resolvesBy,
          detail: market.resolvesBy ? "Expected by" : "After the deadline, with evidence",
          state: closed ? "current" : "upcoming",
        },
  );
  if (resolution) {
    const settled = resolution.settlementStatus === "COMPLETED";
    steps.push({
      key: "settled",
      label: settled ? "Credits settled" : "Settlement",
      date: settled ? resolution.settledAt : null,
      detail: settled ? undefined : resolution.settlementStatus === "FAILED" ? "Retrying" : "In progress",
      state: settled ? "done" : "current",
    });
  } else {
    steps.push({ key: "settled", label: "Credits settled", date: null, state: "upcoming" });
  }
  return steps;
}

/**
 * Splits a startup's markets for its profile: open (closing soonest first),
 * closed and awaiting resolution, and recently resolved or cancelled (newest first).
 */
export function groupStartupMarkets(markets: MarketSummary[]) {
  const byClose = (a: MarketSummary, b: MarketSummary) => Date.parse(a.closesAt) - Date.parse(b.closesAt);
  const endedAt = (market: MarketSummary) => Date.parse(market.resolvedAt ?? market.closesAt);
  return {
    open: markets.filter((market) => market.status === "OPEN").sort(byClose),
    awaiting: markets.filter((market) => market.status === "CLOSED").sort(byClose),
    resolved: markets
      .filter((market) => market.status === "RESOLVED" || market.status === "CANCELLED")
      .sort((a, b) => endedAt(b) - endedAt(a)),
  };
}
