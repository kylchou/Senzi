import { ForecastingError } from '../errors.js';
import type { ForecastRepository } from '../ports.js';
import type { Forecast, Market, MarketSnapshot, SettlementRecord } from '../types.js';

const copy = <T>(v: T): T => structuredClone(v);

/**
 * In-memory repository for tests and local development. Returns copies so
 * callers can't mutate stored records. Replace with the real database adapter
 * once the stack is chosen.
 */
export class InMemoryForecastRepository implements ForecastRepository {
  private readonly markets = new Map<string, Market>();
  private readonly forecasts: Forecast[] = [];
  private readonly forecastKeys = new Set<string>();
  private readonly snapshots = new Map<string, MarketSnapshot[]>();
  private readonly settlements = new Map<string, SettlementRecord>();

  async getMarket(marketId: string) {
    const m = this.markets.get(marketId);
    return m ? copy(m) : null;
  }

  async saveMarket(market: Market) {
    this.markets.set(market.id, copy(market));
  }

  async listMarkets() {
    return [...this.markets.values()].map(copy);
  }

  async findForecastByIdempotencyKey(userId: string, idempotencyKey: string) {
    const f = this.forecasts.find((x) => x.userId === userId && x.idempotencyKey === idempotencyKey);
    return f ? copy(f) : null;
  }

  async recordForecast(forecast: Forecast, snapshot: MarketSnapshot) {
    const key = `${forecast.userId}\u0000${forecast.idempotencyKey}`;
    if (this.forecastKeys.has(key)) {
      throw new ForecastingError('IDEMPOTENCY_CONFLICT', 'Duplicate (userId, idempotencyKey)');
    }
    if (this.forecasts.some((f) => f.marketId === forecast.marketId && f.sequence === forecast.sequence)) {
      throw new ForecastingError('INVARIANT_VIOLATION', 'Duplicate (marketId, sequence)');
    }
    this.forecastKeys.add(key);
    this.forecasts.push(copy(forecast));
    await this.appendSnapshot(snapshot);
  }

  async listForecastsByMarket(marketId: string) {
    return this.forecasts.filter((f) => f.marketId === marketId).sort((a, b) => a.sequence - b.sequence).map(copy);
  }

  async listForecastsByUser(userId: string) {
    return this.forecasts.filter((f) => f.userId === userId).map(copy);
  }

  async appendSnapshot(snapshot: MarketSnapshot) {
    const list = this.snapshots.get(snapshot.marketId) ?? [];
    const last = list[list.length - 1];
    if (last && snapshot.sequence <= last.sequence) {
      throw new ForecastingError('INVARIANT_VIOLATION', 'Snapshot sequence must increase');
    }
    list.push(copy(snapshot));
    this.snapshots.set(snapshot.marketId, list);
  }

  async listSnapshots(marketId: string) {
    return (this.snapshots.get(marketId) ?? []).map(copy);
  }

  async getSettlement(marketId: string) {
    const s = this.settlements.get(marketId);
    return s ? copy(s) : null;
  }

  async saveSettlement(record: SettlementRecord) {
    this.settlements.set(record.marketId, copy(record));
  }

  async listSettlements() {
    return [...this.settlements.values()].map(copy);
  }
}
