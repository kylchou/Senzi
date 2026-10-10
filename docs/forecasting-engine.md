# Forecasting engine (Engineer 2)

Code: `lib/forecasting/`. Tests: `lib/forecasting/__tests__/` (`npm test`). Framework-agnostic TypeScript; no database or web framework is assumed yet.

## What it does

| Spec item | Entry point | Notes |
| --- | --- | --- |
| 1. Forecast submission | `engine.submitForecast(auth, { marketId, side, amount, idempotencyKey })` | Checks auth, market status, opensAt/closesAt, amount limits, eligibility, balance. Returns a receipt with entry info and a SHA-256 digest. |
| 2. Probability calculations | `engine.getMarketEstimates(marketId)`, `engine.recordModelValue(auth, marketId, value)` | Opening baseline, latest model value, general line and verified-only line are separate fields. Each carries a forecaster count and confidence label. |
| 3. Forecast history | `engine.getHistory`, `engine.getChartSeries`, `engine.exportHistoryCsv` | Append-only snapshots on every forecast, model update and settlement. Range filter and downsampling. |
| 4. Virtual portfolio | `engine.getPortfolio(auth, userId)` | Balance comes from the ledger. Active, awaiting-resolution and resolved positions, ledger history, net results. |
| 5. Performance analytics | `engine.getUserStats`, `engine.getLeaderboard`, `engine.getCalibrationReport(line)` | Accuracy with Wilson intervals, streaks, achievements, calibration per line. Every report lists its small-sample limitations. |
| 6. Market settlement | `engine.settleMarket(auth, { marketId, outcome, resolutionId, resolvedAt })` | Idempotent and resumable after a crash. Only the authorized resolution workflow can call it. |

## Integration contracts (`lib/forecasting/ports.ts`)

- **`CreditLedger` (Engineer 1).** Needs `getBalance`, `debit`, `credit` and `listTransactions`. `debit` must be atomic and throw `InsufficientBalanceError`. `debit` and `credit` must be idempotent by `idempotencyKey`. The engine uses these keys:
  - `forecast:{forecastId}` for stakes
  - `forecast-reversal:{forecastId}` for refunds when a forecast fails to store
  - `settlement:{marketId}:{forecastId}` for payouts

  `InMemoryCreditLedger` is a test stand-in only.
- **`SettlementAuthorizer` (Engineer 1).** Identifies the resolution workflow, which calls `settleMarket` as `{ kind: 'service', serviceId }`.
- **`TraderDirectory` (verification service).** Answers `isVerifiedUserOf` and `hasConflictOfInterest`.
- **`ForecastRepository` + `LockManager` (storage).**
  - `recordForecast` must insert the forecast and its snapshot in one transaction, with a unique constraint on `(userId, idempotencyKey)`.
  - `withLocks(['market:{id}'])` maps to a row lock on the market.
  - In production, the ledger debit and the forecast insert should share a transaction. Today a failed insert is compensated with a refund.
- **Model service.** Pushes values with `recordModelValue`. The opening baseline follows the model until the first forecast and is frozen after that. Forecasts never change either value.

## Blocked on open decisions (deliberately not implemented)

- **`CommunityEstimateRule`:** the pricing rule (LMSR vs credit allocation share). With no rule configured, submission returns `NOT_CONFIGURED`. Reads still return the model line.
- **`SettlementModel`:** the "agreed virtual settlement model" is not specified. YES/NO settlement returns `NOT_CONFIGURED`. VOID refunds stakes in full.
- **Unit naming:** credits vs tokens is unsettled. The display label is `config.unitLabel`.
- **`config.requireVerifiedTrader`:** defaults to false. The spec says both "only verified users trade" and "general line = any signed-up user".
- **Thresholds:** the confidence-label cutoffs (1/10/30 forecasters) and the calibration bar (30 markets, ECE ≤ 0.05) are placeholders.
