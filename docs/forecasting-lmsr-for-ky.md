# What LMSR forecasting needs from Ky

The forecasting API, database adapters and settle function work on today's schema (see `docs/forecasting-api.md`), and pass the full integration suite. These items need Ky's sign-off or code, because they touch his files.

## 1. Turn on settlement (one line, plus test updates)

In `lib/settlement.ts`, set:

```ts
import { forecastingSettle as engineSettle } from "@/lib/forecasting/server/settle";
const forecastingSettle: SettleFn | null = engineSettle;
```

When we tried it, five of Ky's integration tests failed, and they need updating:
- **`resolutions.test.ts`:** "stays PENDING until the forecasting engine is configured" is now wrong by design. The other settlement tests in that file also expect the unconfigured behaviour.
- **`placeForecast` in `tests/integration/helpers.ts`:** it creates forecasts without LMSR shares (`fill.shares`). Our settle function refuses to pay those per share and records the settlement as FAILED. The helper should place forecasts through `submitForecastForUser` (or record a `fill`), as `tests/integration/forecasting-api.test.ts` does.
- **`admin.test.ts`:** "lets exactly one settlement worker claim a resolution" fails for the same reason.

The demo seed has the same issue: its forecasts and its two resolved markets predate LMSR. Reseeding with LMSR fills fixes it (see section 5).

## 2. Market-maker ledger account

Team decision: the platform mints the credits that cover the market maker's LMSR losses, recorded in the credit ledger under a dedicated market-maker account so the ledger balances.

The engine already does the double entry when `MARKET_MAKER_ACCOUNT_ID` is set (`lib/forecasting/server/service.ts`). The unit tests show the ledger balancing to the credit. To switch it on, the ledger needs:

- **A system user** for the market maker. It can never sign in or trade.
- **Ledger types,** either new `CreditTransactionType` values, or existing ones Ky prefers. The engine uses these reasons:

| Engine reason | When | Idempotency key |
|---|---|---|
| `market_maker_receive` | Credit: the market maker receives a trader's stake | `market-maker:in:<forecastId>` |
| `market_maker_pay` | Debit: the market maker pays a winner or refunds a VOID | `market-maker:out:<marketId>:<forecastId>` |
| `market_maker_mint` | Credit: subsidy minted once per market when payouts exceed stakes | `market-maker:mint:<marketId>` |
| `market_maker_reversal` | Debit: undo `market_maker_receive` if a forecast fails to store (not used with the database adapter, which rolls back) | `market-maker:reversal:<forecastId>` |

- **`lib/credit-ledger.ts`** must accept those reasons and map each one to the chosen type.

Until then, stakes and payouts touch only traders' balances. The minted subsidy is implicit: per market, payouts minus stakes.

## 3. Optional schema columns

LMSR runs today without schema changes:
- each forecast's `fill` JSON holds `b`, `p0`, `shares`, `averagePrice`, `priceBefore` and `priceAfter`;
- the ledger transaction id is kept in `entry` JSON.

For speed and clarity these columns would help later:
- **`Market.lmsrB Float?`:** b set when the market opens, instead of derived.
- **`Market.qYes Float`, `Market.qNo Float`:** the running share totals, instead of replaying every fill on each trade. That's fine at dozens of trades per market.
- **`Forecast.shares Float?`**

## 4. `docs/API.md` is out of date

Its "Team decision (2026-10-09)" says allocation share with pari-mutuel payouts. The team replaced it with LMSR on 2026-10-10. Please point that section at `docs/forecasting-api.md`.

## 5. Demo seed

The seed's markets and forecasts predate LMSR and the six-company dataset. Reseeding plan:
- **Companies:** Stripe, Vercel, Supabase, PostHog, Resend and Convex, with the model's baselines.
- **Trades:** simulated trades placed through the engine, so they get LMSR fills.
- **Labels:** simulated trades labelled as simulated.

The data export for this is the next Felix task.
