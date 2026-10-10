// Performance analytics: per-user statistics, achievements, leaderboards and
// calibration of each chart line. Every report states its limitations when the
// sample is small. The leaderboard is the prize mechanism for the prototype;
// no payouts are computed here.

import type { EngineDeps } from './deps.js';
import type { CalibrationEvidence, EstimateLine } from './estimates.js';
import { snapshotAt } from './history.js';
import { brierScore, calibrationBins, expectedCalibrationError, wilsonInterval, type Bin } from './stats.js';
import type { Forecast, Market, MarketSnapshot, SettlementRecord } from './types.js';

// ---------------------------------------------------------------------------
// Shared loading

interface AnalyticsData {
  markets: Map<string, Market>;
  settlements: Map<string, SettlementRecord>;
}

async function loadSettled(deps: EngineDeps): Promise<AnalyticsData> {
  const [markets, settlements] = await Promise.all([deps.repo.listMarkets(), deps.repo.listSettlements()]);
  return {
    markets: new Map(markets.map((m) => [m.id, m])),
    settlements: new Map(settlements.filter((s) => s.status === 'completed').map((s) => [s.marketId, s])),
  };
}

interface ResolvedForecast {
  forecast: Forecast;
  outcome: 'YES' | 'NO' | 'VOID';
  correct: boolean | null;
  net: number;
  payout: number;
  settledAt: Date;
}

function resolvedForecasts(forecasts: readonly Forecast[], data: AnalyticsData): ResolvedForecast[] {
  const out: ResolvedForecast[] = [];
  for (const f of forecasts) {
    const s = data.settlements.get(f.marketId);
    if (!s || !s.settledAt) continue;
    const p = s.payouts.find((x) => x.forecastId === f.id);
    out.push({
      forecast: f,
      outcome: s.outcome,
      correct: s.outcome === 'VOID' ? null : s.outcome === f.side,
      net: p?.net ?? 0,
      payout: p?.payout ?? 0,
      settledAt: s.settledAt,
    });
  }
  // Resolution order, then entry order: defines streaks and achievement dates.
  return out.sort(
    (a, b) =>
      a.settledAt.getTime() - b.settledAt.getTime() ||
      a.forecast.acceptedAt.getTime() - b.forecast.acceptedAt.getTime() ||
      a.forecast.sequence - b.forecast.sequence,
  );
}

// ---------------------------------------------------------------------------
// User statistics and achievements

export interface Achievement {
  id: string;
  title: string;
  description: string;
  earnedAt: Date;
}

export interface UserStats {
  userId: string;
  forecasts: number;
  marketsForecast: number;
  totalStaked: number;
  averageStake: number | null;
  /** Resolved YES/NO forecasts (void excluded). */
  resolvedForecasts: number;
  voidForecasts: number;
  correct: number;
  /** Share of resolved forecasts on the winning side. */
  accuracy: number | null;
  /** 95% Wilson interval on accuracy. */
  accuracyInterval: [number, number] | null;
  /** Accuracy weighted by stake. */
  stakeWeightedAccuracy: number | null;
  netResult: number;
  currentStreak: number;
  bestStreak: number;
  verifiedForecasts: number;
  achievements: Achievement[];
  limitations: string[];
}

const ACHIEVEMENTS = {
  first_forecast: { title: 'First forecast', description: 'Placed a first forecast' },
  ten_forecasts: { title: 'Regular', description: 'Placed 10 forecasts' },
  first_correct: { title: 'On the board', description: 'First forecast on the winning side' },
  five_correct: { title: 'Sharp', description: '5 forecasts on the winning side' },
  streak_three: { title: 'Hot streak', description: '3 winning forecasts in a row' },
  against_the_crowd: {
    title: 'Against the crowd',
    description: 'Won a forecast placed against the community estimate at the time',
  },
  early_and_right: { title: 'Early and right', description: 'Won a forecast that was among the first 5 on its market' },
  verified_voice: { title: 'Verified voice', description: 'Forecast as a verified user of the product' },
} as const;

type AchievementId = keyof typeof ACHIEVEMENTS;

function wentAgainstCrowd(f: Forecast): boolean {
  const before = f.entry.generalBefore;
  if (before === null) return false;
  return (f.side === 'YES' && before < 0.5) || (f.side === 'NO' && before > 0.5);
}

export function computeUserStats(
  userId: string,
  forecasts: readonly Forecast[],
  data: AnalyticsData,
  minResolved: number,
): UserStats {
  const byEntry = [...forecasts].sort((a, b) => a.acceptedAt.getTime() - b.acceptedAt.getTime() || a.sequence - b.sequence);
  const resolved = resolvedForecasts(forecasts, data);
  const decided = resolved.filter((r) => r.correct !== null);
  const correct = decided.filter((r) => r.correct);
  const decidedStake = decided.reduce((s, r) => s + r.forecast.amount, 0);
  const correctStake = correct.reduce((s, r) => s + r.forecast.amount, 0);
  const totalStaked = forecasts.reduce((s, f) => s + f.amount, 0);

  const earned = new Map<AchievementId, Date>();
  const earn = (id: AchievementId, at: Date) => {
    if (!earned.has(id)) earned.set(id, at);
  };
  if (byEntry[0]) earn('first_forecast', byEntry[0].acceptedAt);
  if (byEntry[9]) earn('ten_forecasts', byEntry[9].acceptedAt);
  const firstVerified = byEntry.find((f) => f.verifiedAtEntry);
  if (firstVerified) earn('verified_voice', firstVerified.acceptedAt);

  let streak = 0;
  let bestStreak = 0;
  let wins = 0;
  for (const r of decided) {
    if (r.correct) {
      streak++;
      wins++;
      bestStreak = Math.max(bestStreak, streak);
      if (wins === 1) earn('first_correct', r.settledAt);
      if (wins === 5) earn('five_correct', r.settledAt);
      if (streak === 3) earn('streak_three', r.settledAt);
      if (wentAgainstCrowd(r.forecast)) earn('against_the_crowd', r.settledAt);
      if (r.forecast.sequence <= 5) earn('early_and_right', r.settledAt);
    } else {
      streak = 0;
    }
  }

  const limitations: string[] = [];
  if (decided.length === 0) limitations.push('No resolved forecasts yet, so accuracy is not available.');
  else if (decided.length < minResolved) {
    limitations.push(
      `Only ${decided.length} resolved forecast${decided.length === 1 ? '' : 's'}; accuracy is not meaningful below ${minResolved}. See the interval.`,
    );
  }

  return {
    userId,
    forecasts: forecasts.length,
    marketsForecast: new Set(forecasts.map((f) => f.marketId)).size,
    totalStaked,
    averageStake: forecasts.length ? totalStaked / forecasts.length : null,
    resolvedForecasts: decided.length,
    voidForecasts: resolved.length - decided.length,
    correct: correct.length,
    accuracy: decided.length ? correct.length / decided.length : null,
    accuracyInterval: wilsonInterval(correct.length, decided.length),
    stakeWeightedAccuracy: decidedStake ? correctStake / decidedStake : null,
    netResult: resolved.reduce((s, r) => s + r.net, 0),
    currentStreak: streak,
    bestStreak,
    verifiedForecasts: forecasts.filter((f) => f.verifiedAtEntry).length,
    achievements: [...earned.entries()]
      .map(([id, earnedAt]) => ({ id, ...ACHIEVEMENTS[id], earnedAt }))
      .sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime()),
    limitations,
  };
}

export async function getUserStats(deps: EngineDeps, userId: string): Promise<UserStats> {
  const [forecasts, data] = await Promise.all([deps.repo.listForecastsByUser(userId), loadSettled(deps)]);
  return computeUserStats(userId, forecasts, data, deps.config.leaderboard.minResolvedForAccuracyRank);
}

// ---------------------------------------------------------------------------
// Leaderboard

export type LeaderboardMetric = 'net_result' | 'accuracy' | 'resolved_forecasts';

export interface LeaderboardEntry {
  /** Competition ranking (ties share a rank). Null when not eligible for this metric. */
  rank: number | null;
  userId: string;
  value: number | null;
  resolvedForecasts: number;
  accuracy: number | null;
  accuracyInterval: [number, number] | null;
  netResult: number;
  achievements: number;
  note?: string;
}

export interface Leaderboard {
  metric: LeaderboardMetric;
  entries: LeaderboardEntry[];
  minResolvedForAccuracyRank: number;
  limitations: string[];
  asOf: Date;
}

export async function getLeaderboard(
  deps: EngineDeps,
  options: { metric?: LeaderboardMetric; limit?: number } = {},
): Promise<Leaderboard> {
  const metric = options.metric ?? 'net_result';
  const minResolved = deps.config.leaderboard.minResolvedForAccuracyRank;
  const data = await loadSettled(deps);

  const byUser = new Map<string, Forecast[]>();
  for (const marketId of data.markets.keys()) {
    for (const f of await deps.repo.listForecastsByMarket(marketId)) {
      const list = byUser.get(f.userId) ?? [];
      list.push(f);
      byUser.set(f.userId, list);
    }
  }

  const stats = [...byUser.entries()].map(([userId, fs]) => computeUserStats(userId, fs, data, minResolved));

  const ranked: Array<{ s: UserStats; value: number; tiebreak: number }> = [];
  const unranked: LeaderboardEntry[] = [];
  for (const s of stats) {
    const base = {
      userId: s.userId,
      resolvedForecasts: s.resolvedForecasts,
      accuracy: s.accuracy,
      accuracyInterval: s.accuracyInterval,
      netResult: s.netResult,
      achievements: s.achievements.length,
    };
    if (metric === 'accuracy') {
      if (s.resolvedForecasts < minResolved || s.accuracy === null) {
        unranked.push({
          ...base,
          rank: null,
          value: s.accuracy,
          note: `Needs ${minResolved} resolved forecasts to be ranked (has ${s.resolvedForecasts})`,
        });
      } else {
        // Ties on accuracy go to the user with more evidence (higher interval lower bound).
        ranked.push({ s, value: s.accuracy, tiebreak: s.accuracyInterval?.[0] ?? 0 });
      }
    } else if (s.resolvedForecasts + s.voidForecasts === 0) {
      unranked.push({ ...base, rank: null, value: null, note: 'No resolved forecasts yet' });
    } else {
      ranked.push({
        s,
        value: metric === 'net_result' ? s.netResult : s.resolvedForecasts,
        tiebreak: 0,
      });
    }
  }

  ranked.sort((a, b) => b.value - a.value || b.tiebreak - a.tiebreak || a.s.userId.localeCompare(b.s.userId));
  const entries: LeaderboardEntry[] = [];
  ranked.forEach((r, i) => {
    const prev = ranked[i - 1];
    const tied = prev && prev.value === r.value && prev.tiebreak === r.tiebreak;
    entries.push({
      rank: tied ? entries[i - 1]!.rank : i + 1,
      userId: r.s.userId,
      value: r.value,
      resolvedForecasts: r.s.resolvedForecasts,
      accuracy: r.s.accuracy,
      accuracyInterval: r.s.accuracyInterval,
      netResult: r.s.netResult,
      achievements: r.s.achievements.length,
    });
  });
  unranked.sort((a, b) => b.resolvedForecasts - a.resolvedForecasts || a.userId.localeCompare(b.userId));

  const limitations: string[] = [];
  const settledCount = data.settlements.size;
  if (settledCount < deps.config.calibration.minResolvedMarkets) {
    limitations.push(
      `Based on ${settledCount} resolved market${settledCount === 1 ? '' : 's'}; rankings will move a lot as more resolve.`,
    );
  }
  if (metric === 'net_result') {
    limitations.push('Net result depends on the settlement model and stake sizes, not just forecasting skill.');
  }

  const all = [...entries, ...unranked];
  return {
    metric,
    entries: options.limit ? all.slice(0, options.limit) : all,
    minResolvedForAccuracyRank: minResolved,
    limitations,
    asOf: deps.clock.now(),
  };
}

// ---------------------------------------------------------------------------
// Calibration

export type CalibrationLine = 'model' | 'opening_baseline' | EstimateLine;

export interface CalibrationReport {
  line: CalibrationLine;
  /** For community lines: the rule whose snapshots were evaluated. */
  estimateRuleId: string | null;
  /** Markets evaluated (resolved YES/NO with an estimate at close). */
  resolvedMarkets: number;
  excluded: { void: number; noEstimateAtClose: number; differentRule: number };
  baseRate: number | null;
  brierScore: number | null;
  /** Brier score of always predicting the base rate, as a reference point. */
  baseRateBrierScore: number | null;
  expectedCalibrationError: number | null;
  bins: Bin[];
  sufficient: boolean;
  limitations: string[];
}

function lineValue(s: MarketSnapshot, line: CalibrationLine): number | null {
  switch (line) {
    case 'model':
      return s.model;
    case 'opening_baseline':
      return s.openingBaseline;
    case 'general':
      return s.general;
    case 'specialized':
      return s.specialized;
  }
}

/**
 * Compares each line's value at the forecast deadline with how markets resolved.
 * Forecasts are YES/NO allocations rather than stated probabilities, so this
 * measures the market-level estimate, not individual forecasters.
 */
export async function getCalibrationReport(deps: EngineDeps, line: CalibrationLine): Promise<CalibrationReport> {
  const data = await loadSettled(deps);
  const ruleId = line === 'general' || line === 'specialized' ? deps.estimateRule?.id ?? null : null;
  const minMarkets = deps.config.calibration.minResolvedMarkets;
  const pairs: Array<{ predicted: number; actual: 0 | 1 }> = [];
  const excluded = { void: 0, noEstimateAtClose: 0, differentRule: 0 };

  for (const s of data.settlements.values()) {
    if (s.outcome === 'VOID') {
      excluded.void++;
      continue;
    }
    const market = data.markets.get(s.marketId);
    if (!market) continue;
    const snap = snapshotAt(await deps.repo.listSnapshots(s.marketId), market.closesAt);
    const value = snap ? lineValue(snap, line) : null;
    if (!snap || value === null) {
      excluded.noEstimateAtClose++;
      continue;
    }
    if ((line === 'general' || line === 'specialized') && snap.estimateRuleId !== ruleId) {
      excluded.differentRule++;
      continue;
    }
    pairs.push({ predicted: value, actual: s.outcome === 'YES' ? 1 : 0 });
  }

  const n = pairs.length;
  const bins = calibrationBins(pairs, deps.config.calibration.bins);
  const baseRate = n ? pairs.reduce((s, p) => s + p.actual, 0) / n : null;
  const limitations: string[] = [];
  if (n === 0) limitations.push('No resolved markets with an estimate for this line yet.');
  else if (n < minMarkets) {
    limitations.push(
      `Only ${n} resolved market${n === 1 ? '' : 's'}; at least ${minMarkets} are needed before calibration can be judged.`,
    );
  }
  const thinBins = bins.filter((b) => b.count > 0 && b.count < 5).length;
  if (thinBins) {
    limitations.push(`${thinBins} bin${thinBins === 1 ? ' has' : 's have'} fewer than 5 markets; see the intervals.`);
  }
  if (n > 0) {
    limitations.push(
      'Questions about the same company or period are correlated, so the effective sample is smaller than the market count.',
    );
  }
  if (excluded.void) limitations.push(`${excluded.void} voided market(s) excluded.`);
  if (excluded.differentRule) {
    limitations.push(`${excluded.differentRule} market(s) priced under a different estimate rule excluded.`);
  }

  return {
    line,
    estimateRuleId: ruleId,
    resolvedMarkets: n,
    excluded,
    baseRate,
    brierScore: brierScore(pairs),
    baseRateBrierScore: baseRate === null ? null : brierScore(pairs.map((p) => ({ predicted: baseRate, actual: p.actual }))),
    expectedCalibrationError: expectedCalibrationError(bins),
    bins,
    sufficient: n >= minMarkets,
    limitations,
  };
}

/** The evidence used to decide whether a community line may be labeled a calibrated probability. */
export async function getCalibrationEvidence(deps: EngineDeps, line: EstimateLine): Promise<CalibrationEvidence | undefined> {
  if (!deps.estimateRule) return undefined;
  const report = await getCalibrationReport(deps, line);
  if (report.expectedCalibrationError === null) return undefined;
  return {
    line,
    estimateRuleId: deps.estimateRule.id,
    resolvedMarkets: report.resolvedMarkets,
    expectedCalibrationError: report.expectedCalibrationError,
    sufficient: report.sufficient,
  };
}
