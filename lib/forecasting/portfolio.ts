// A user's virtual portfolio: balance (read from Engineer 1's ledger), active
// and resolved forecasts with their original entry information, ledger history
// and virtual results.

import type { EngineDeps } from './deps.js';
import { ForecastingError } from './errors.js';
import type { AuthContext } from './ports.js';
import type { EntrySnapshot, Forecast, Market, MarketSnapshot, Outcome, Side, SettlementRecord } from './types.js';

export type PositionStatus = 'active' | 'awaiting_resolution' | 'resolved' | 'cancelled';
export type PositionResult = 'won' | 'lost' | 'void' | 'pending';

export interface PositionView {
  forecastId: string;
  marketId: string;
  companyId: string;
  question: string;
  side: Side;
  amount: number;
  acceptedAt: Date;
  sequence: number;
  verifiedAtEntry: boolean;
  /** What the market looked like when this forecast was accepted. Never rewritten. */
  entry: EntrySnapshot;
  fill: Record<string, number> | null;
  status: PositionStatus;
  closesAt: Date;
  /** Latest values, for positions whose market hasn't resolved. */
  current: { model: number | null; general: number | null; specialized: number | null; at: Date } | null;
  outcome: Outcome | null;
  payout: number | null;
  net: number | null;
  result: PositionResult;
  settledAt: Date | null;
}

export interface PortfolioHistoryItem {
  at: Date;
  ledgerTransactionId: string;
  reason: string;
  delta: number;
  balanceAfter: number;
  forecastId: string | null;
  marketId: string | null;
  question: string | null;
}

export interface PortfolioTotals {
  forecasts: number;
  activeStake: number;
  awaitingResolutionStake: number;
  resolvedStake: number;
  totalPayout: number;
  /** Sum of payout - stake over resolved positions. */
  netResult: number;
  won: number;
  lost: number;
  void: number;
}

export interface Portfolio {
  userId: string;
  unitLabel: string;
  balance: number;
  active: PositionView[];
  awaitingResolution: PositionView[];
  resolved: PositionView[];
  cancelled: PositionView[];
  history: PortfolioHistoryItem[];
  totals: PortfolioTotals;
  asOf: Date;
}

function authorizeView(auth: AuthContext, userId: string): void {
  if (auth.kind === 'service') return;
  if (auth.kind !== 'user') throw new ForecastingError('UNAUTHENTICATED', 'Sign in to continue');
  if (auth.userId !== userId) throw new ForecastingError('FORBIDDEN', "You can only view your own portfolio");
}

export function positionFor(
  f: Forecast,
  market: Market,
  settlement: SettlementRecord | null,
  latest: MarketSnapshot | null,
  now: Date,
): PositionView {
  const completed = settlement?.status === 'completed' ? settlement : null;
  const payout = completed?.payouts.find((p) => p.forecastId === f.id) ?? null;

  let status: PositionStatus;
  if (completed) status = 'resolved';
  else if (market.status === 'cancelled') status = 'cancelled';
  else if (market.status === 'open' && now < market.closesAt) status = 'active';
  else status = 'awaiting_resolution';

  let result: PositionResult = 'pending';
  if (completed) {
    if (completed.outcome === 'VOID') result = 'void';
    else result = completed.outcome === f.side ? 'won' : 'lost';
  }

  return {
    forecastId: f.id,
    marketId: f.marketId,
    companyId: market.companyId,
    question: market.question,
    side: f.side,
    amount: f.amount,
    acceptedAt: f.acceptedAt,
    sequence: f.sequence,
    verifiedAtEntry: f.verifiedAtEntry,
    entry: f.entry,
    fill: f.fill ?? null,
    status,
    closesAt: market.closesAt,
    current:
      status !== 'resolved' && latest
        ? { model: latest.model, general: latest.general, specialized: latest.specialized, at: latest.at }
        : null,
    outcome: completed?.outcome ?? null,
    payout: payout?.payout ?? null,
    net: payout?.net ?? null,
    result,
    settledAt: completed?.settledAt ?? null,
  };
}

export async function getPortfolio(deps: EngineDeps, auth: AuthContext, userId: string): Promise<Portfolio> {
  authorizeView(auth, userId);
  const { repo, ledger } = deps;
  const now = deps.clock.now();

  const [balance, forecasts, transactions] = await Promise.all([
    ledger.getBalance(userId),
    repo.listForecastsByUser(userId),
    ledger.listTransactions(userId),
  ]);

  const marketIds = [...new Set(forecasts.map((f) => f.marketId))];
  const markets = new Map<string, Market>();
  const settlements = new Map<string, SettlementRecord | null>();
  const latest = new Map<string, MarketSnapshot | null>();
  await Promise.all(
    marketIds.map(async (id) => {
      const [m, s, snaps] = await Promise.all([repo.getMarket(id), repo.getSettlement(id), repo.listSnapshots(id)]);
      if (!m) throw new ForecastingError('INVARIANT_VIOLATION', `Forecast refers to missing market ${id}`);
      markets.set(id, m);
      settlements.set(id, s);
      latest.set(id, snaps[snaps.length - 1] ?? null);
    }),
  );

  const positions = forecasts
    .map((f) => positionFor(f, markets.get(f.marketId)!, settlements.get(f.marketId) ?? null, latest.get(f.marketId) ?? null, now))
    .sort((a, b) => b.acceptedAt.getTime() - a.acceptedAt.getTime() || b.sequence - a.sequence);

  const byStatus = (s: PositionStatus) => positions.filter((p) => p.status === s);
  const sum = (ps: PositionView[], pick: (p: PositionView) => number) => ps.reduce((acc, p) => acc + pick(p), 0);
  const active = byStatus('active');
  const awaitingResolution = byStatus('awaiting_resolution');
  const resolved = byStatus('resolved');
  const cancelled = byStatus('cancelled');

  const forecastById = new Map(forecasts.map((f) => [f.id, f]));
  // Newest first. The ledger lists transactions in the order applied, so ties on
  // timestamp fall back to that order (reversed).
  const history: PortfolioHistoryItem[] = transactions
    .map((t, index) => {
      const f = forecastById.get(t.reference);
      return {
        index,
        item: {
          at: t.createdAt,
          ledgerTransactionId: t.id,
          reason: t.reason,
          delta: t.delta,
          balanceAfter: t.balanceAfter,
          forecastId: f?.id ?? null,
          marketId: f?.marketId ?? null,
          question: f ? markets.get(f.marketId)?.question ?? null : null,
        },
      };
    })
    .sort((a, b) => b.item.at.getTime() - a.item.at.getTime() || b.index - a.index)
    .map((x) => x.item);

  return {
    userId,
    unitLabel: deps.config.unitLabel,
    balance,
    active,
    awaitingResolution,
    resolved,
    cancelled,
    history,
    totals: {
      forecasts: positions.length,
      activeStake: sum(active, (p) => p.amount),
      awaitingResolutionStake: sum(awaitingResolution, (p) => p.amount),
      resolvedStake: sum(resolved, (p) => p.amount),
      totalPayout: sum(resolved, (p) => p.payout ?? 0),
      netResult: sum(resolved, (p) => p.net ?? 0),
      won: resolved.filter((p) => p.result === 'won').length,
      lost: resolved.filter((p) => p.result === 'lost').length,
      void: resolved.filter((p) => p.result === 'void').length,
    },
    asOf: now,
  };
}
