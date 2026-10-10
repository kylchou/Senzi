# Forecasting API (LMSR)

Pricing is an LMSR automated market maker (team decision, 2026-10-10). This replaces the credit allocation share described in `docs/API.md`. Code: `lib/forecasting/` (engine, `lmsr.ts`, `lmsr-pricing.ts`) and `lib/forecasting/server/` (database adapters, API handlers, settle function).

All responses use the shared envelope from `docs/API.md`: `{ data }` or `{ error: { code, message, details } }`. For engine errors, `details.reason` holds the specific cause (e.g. `PRICE_MOVED`, `DEADLINE_PASSED`, `NOT_ELIGIBLE`).

## Endpoints

### `GET /api/forecasts/quote?marketId=…&side=YES|NO&credits=100`

What spending `credits` would get right now. Not binding. Works signed out for markets you can see.

```json
{ "data": { "marketId": "…", "side": "YES", "credits": 100, "shares": 245.1, "averagePrice": 0.408,
            "priceBefore": 0.40, "priceAfter": 0.415, "tolerance": 0.02,
            "quotedAt": "2026-10-10T12:00:00.000Z", "label": "Market probability (all users)" } }
```

Prices are the YES price (the market probability) before and after the trade.

### `POST /api/forecasts` (signed in)

Body: `{ marketId, side, credits, idempotencyKey, quotedPrice? }`

- **`credits`:** whole credits to spend.
- **`idempotencyKey`:** one per intended trade. Resending it returns the original receipt (`200`, `replayed: true`). Reusing it for a different trade returns `CONFLICT`.
- **`quotedPrice` (optional):** the `priceBefore` from the quote the user saw. If the YES price has moved more than 0.02 since then, the server rejects the trade with `409 CONFLICT`. In that case `details.reason` is `PRICE_MOVED`, and `details.quote` holds a fresh quote (`shares`, `averagePrice`, `priceBefore`, `priceAfter`). Show it and let the user confirm again.

Success (`201`):

```json
{ "data": { "id": "…", "marketId": "…", "side": "YES", "credits": 100, "createdAt": "…", "balanceAfter": 900,
            "shares": 245.1, "averagePrice": 0.408, "priceBefore": 0.40, "priceAfter": 0.415,
            "sequence": 3, "replayed": false, "digest": "sha256…" } }
```

The first six fields are what `ForecastPanel` already reads. `entryAllocationShare` is gone: under LMSR the entry price is `priceBefore`.

| Error | When |
|---|---|
| `UNAUTHENTICATED` | Not signed in |
| `NOT_FOUND` | Unknown market, or one you can't see (drafts, private markets) |
| `FORBIDDEN` | You created the market, or you're in its sponsoring organization |
| `INVALID_STATE` | Market not open, before `opensAt`, past `closesAt`, or no opening price |
| `INSUFFICIENT_CREDITS` | Balance below `credits` |
| `CONFLICT` | `PRICE_MOVED` (with new quote) or idempotency key reused for a different trade |
| `VALIDATION_ERROR` | Bad body, or `credits` outside the market's min/max |
| `RATE_LIMITED` | More than 60 submissions a minute |

### `GET /api/portfolio` (signed in)

Returns the balance (from Ky's ledger) and three lists of positions (`active`, `awaitingResolution`, `resolved`). Each position carries its entry details and `fill` (shares, prices), plus the current model and market values. Resolved positions also have `outcome`, `payout`, `net` and `result` (`won` / `lost` / `void`). The response also includes the ledger `history` and `totals`.

### `GET /api/leaderboard?metric=net_result|accuracy|resolved_forecasts&limit=50`

Ranked entries plus `limitations` (small-sample warnings). Voided questions are excluded from accuracy.

## Labels (team decision)

- **"Model baseline":** the model's value. The value at open is labelled "Model baseline (at open)".
- **"Market probability (all users)":** the LMSR price from every trade (`MarketSnapshot.generalEstimate`).
- **"Market probability (verified users)":** the same LMSR rule replayed over verified users' trades from the same opening price (`MarketSnapshot.specializedEstimate`). It stays empty until verification exists.
- **"Calibrated":** add this tag only when the engine reports `isCalibratedProbability: true`. Never present the price as calibrated otherwise.
- **`allocationShare`:** still recorded on snapshots as a separate statistic. It is not the price.

## How the price works

- **Opening price:** each market opens at the model's opening baseline p0, clamped to 5–95%, with `qNo = 0` and `qYes = b·ln(p0/(1−p0))`.
- **Liquidity b:** `b ≈ 1,700 × (signup grant / 1,000)`, so a 100-credit trade at 50% moves the price about 3 points. When the model's latest baseline is low-confidence, b is lower (×0.6), so the crowd moves the price faster. The first trade freezes b in every fill.
- **Trading:** buy only. To exit, buy the other side; one YES plus one NO share always pays exactly 1.
- **Settlement:** winners get 1 credit per share, rounded down to whole credits. VOID refunds what each trader spent. The market maker's worst-case subsidy per market is `b·ln(1/min(p0, 1−p0))`.
