// The model pushes new values here when new data arrives. This is the only way
// the model line or the opening baseline changes; forecasts never touch them.

import { marketLockKey, type EngineDeps } from './deps.js';
import { ForecastingError } from './errors.js';
import { validateBaseline } from './estimates.js';
import { buildSnapshot } from './history.js';
import type { AuthContext } from './ports.js';
import type { Baseline, Market } from './types.js';

export interface ModelUpdateResult {
  market: Market;
  /** True when this update also set the opening baseline (no forecasts yet). */
  openingBaselineUpdated: boolean;
}

export async function recordModelValue(
  deps: EngineDeps,
  auth: AuthContext,
  marketId: string,
  value: Baseline,
): Promise<ModelUpdateResult> {
  if (auth.kind !== 'service' || !deps.modelServiceIds.includes(auth.serviceId)) {
    throw new ForecastingError('FORBIDDEN', 'Only the model service can publish model values');
  }
  validateBaseline(value);

  return deps.locks.withLocks([marketLockKey(marketId)], async () => {
    const market = await deps.repo.getMarket(marketId);
    if (!market) throw new ForecastingError('MARKET_NOT_FOUND', 'Market not found', { marketId });
    if (market.status === 'resolved' || market.status === 'cancelled') {
      throw new ForecastingError('MARKET_NOT_OPEN', `Market is ${market.status}`, { status: market.status });
    }
    if (market.model && value.asOf < market.model.asOf) {
      throw new ForecastingError('VALIDATION_FAILED', 'Model value is older than the current one', {
        currentAsOf: market.model.asOf.toISOString(),
      });
    }

    const forecasts = await deps.repo.listForecastsByMarket(marketId);
    const openingBaselineUpdated = forecasts.length === 0;
    const updated: Market = {
      ...market,
      model: { ...value },
      openingBaseline: openingBaselineUpdated ? { ...value } : market.openingBaseline,
    };
    await deps.repo.saveMarket(updated);
    await deps.repo.appendSnapshot(
      buildSnapshot({
        market: updated,
        forecasts,
        rule: deps.estimateRule,
        trigger: 'model_update',
        at: deps.clock.now(),
        sequence: (await deps.repo.listSnapshots(marketId)).length + 1,
      }),
    );
    return { market: updated, openingBaselineUpdated };
  });
}
