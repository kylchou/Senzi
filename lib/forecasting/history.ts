// Timestamped, append-only estimate history: one snapshot per accepted forecast,
// per model update, and at settlement. Feeds the three-line chart, reports and
// calibration analysis.

import { ForecastingError } from './errors';
import { computeLine, verifiedOnly } from './estimates';
import type { CommunityEstimateRule } from './ports';
import type { EstimateKind, Forecast, Market, MarketSnapshot, SnapshotTrigger } from './types';

export function buildSnapshot(params: {
  market: Market;
  /** Every forecast on the market up to and including this point. */
  forecasts: readonly Forecast[];
  rule: CommunityEstimateRule | undefined;
  trigger: SnapshotTrigger;
  at: Date;
  sequence: number;
  forecastId?: string;
}): MarketSnapshot {
  const { market, forecasts, rule } = params;
  const opening = market.openingBaseline?.value ?? null;
  const general = computeLine(rule, opening, forecasts);
  const specialized = computeLine(rule, opening, verifiedOnly(forecasts));
  return {
    marketId: market.id,
    sequence: params.sequence,
    at: params.at,
    trigger: params.trigger,
    ...(params.forecastId ? { forecastId: params.forecastId } : {}),
    openingBaseline: opening,
    model: market.model?.value ?? null,
    general: general.value,
    specialized: specialized.value,
    generalForecasters: general.forecasterCount,
    specializedForecasters: specialized.forecasterCount,
    generalAmount: general.totalAmount,
    specializedAmount: specialized.totalAmount,
    estimateRuleId: rule?.id ?? null,
    estimateKind: rule?.kind ?? null,
  };
}

/** Next snapshot number for a market. Uses the highest existing number, since other code (e.g. market opening) also writes snapshots. */
export async function nextSnapshotSequence(repo: { listSnapshots(marketId: string): Promise<MarketSnapshot[]> }, marketId: string): Promise<number> {
  const snaps = await repo.listSnapshots(marketId);
  return snaps.reduce((m, s) => Math.max(m, s.sequence), 0) + 1;
}

export interface HistoryQuery {
  from?: Date;
  to?: Date;
  /** Downsample to at most this many points (>= 2). The first and last points are always kept. */
  maxPoints?: number;
}

export function selectHistory(snapshots: readonly MarketSnapshot[], query: HistoryQuery = {}): MarketSnapshot[] {
  const { from, to, maxPoints } = query;
  if (from && to && from > to) {
    throw new ForecastingError('VALIDATION_FAILED', '`from` must not be after `to`');
  }
  const inRange = snapshots.filter((s) => (!from || s.at >= from) && (!to || s.at <= to));
  if (maxPoints === undefined || inRange.length <= maxPoints) return inRange;
  if (!Number.isInteger(maxPoints) || maxPoints < 2) {
    throw new ForecastingError('VALIDATION_FAILED', 'maxPoints must be an integer >= 2');
  }
  // Keep the first point, then the last point of each bucket so the final value
  // of every interval (and the latest point overall) survives.
  const rest = inRange.length - 1;
  const buckets = maxPoints - 1;
  const picked: MarketSnapshot[] = [inRange[0]!];
  for (let b = 1; b <= buckets; b++) {
    const idx = Math.round((b * rest) / buckets);
    const snap = inRange[idx]!;
    if (picked[picked.length - 1] !== snap) picked.push(snap);
  }
  return picked;
}

/** The latest snapshot at or before `at`, or null if none exists yet. */
export function snapshotAt(snapshots: readonly MarketSnapshot[], at: Date): MarketSnapshot | null {
  let found: MarketSnapshot | null = null;
  for (const s of snapshots) {
    if (s.at <= at) found = s;
    else break;
  }
  return found;
}

export interface ChartPoint {
  at: Date;
  value: number | null;
}

/** The three lines a sponsor reads, plus the fixed opening baseline as a reference. */
export interface ChartSeries {
  marketId: string;
  estimateKind: EstimateKind | null;
  openingBaseline: number | null;
  model: ChartPoint[];
  general: ChartPoint[];
  specialized: ChartPoint[];
}

export function toChartSeries(marketId: string, snapshots: readonly MarketSnapshot[]): ChartSeries {
  const last = snapshots[snapshots.length - 1];
  return {
    marketId,
    estimateKind: last?.estimateKind ?? null,
    openingBaseline: last?.openingBaseline ?? null,
    model: snapshots.map((s) => ({ at: s.at, value: s.model })),
    general: snapshots.map((s) => ({ at: s.at, value: s.general })),
    specialized: snapshots.map((s) => ({ at: s.at, value: s.specialized })),
  };
}

const CSV_COLUMNS = [
  'marketId',
  'sequence',
  'at',
  'trigger',
  'forecastId',
  'openingBaseline',
  'model',
  'general',
  'specialized',
  'generalForecasters',
  'specializedForecasters',
  'generalAmount',
  'specializedAmount',
  'estimateRuleId',
  'estimateKind',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** For reports and offline analysis. */
export function snapshotsToCsv(snapshots: readonly MarketSnapshot[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const s of snapshots) lines.push(CSV_COLUMNS.map((c) => csvCell(s[c])).join(','));
  return lines.join('\n') + '\n';
}
