# Reminder: displayed activity counts are inflated for the demo

**Status:** on (decided by Felix, Oct 10, 2026). Temporary, for the hackathon demo only.

## What we're doing

Market cards, market pages, charts, Market Replay and the VC views show forecast counts, forecaster counts and credits staked that are **18–32 times the real numbers**. The seed places about 30–80 simulated trades per market, so a market shows roughly 600–2,500 forecasts.

The point is to convey to judges that the app would attract a lot of traders and data. Trades are already simulated; this scales how many we show.

Each market gets one fixed factor (from a hash of its id), so a market shows the same number on every page and on every reload.

## Where it lives

- `lib/demo-scale.ts`: the factor and `demoCount()`. Turn it off with `DEMO_INFLATE_COUNTS=false`.
- Applied where counts are read for display:
  - `lib/market-view/mappers.ts`: market cards, the market page, startup pages.
  - `lib/market-view/queries.ts`: market chart history.
  - `lib/market-view/replay-data.ts`: Market Replay.
  - `lib/vc/server/forecasting-adapter.ts`: VC dashboard, studies, reports, watch cards.

## What is NOT inflated (real numbers)

- Prices, probabilities, the model line, the general and verified lines.
- A user's own positions, balance, portfolio and receipts.
- Settlement, payouts, the leaderboard API and the admin pages (admins see real counts).
- The engine's own confidence labels.

## Known iffy numbers while this is on

- **"Low participation" warnings and minimum-participant filters** on the VC side read the inflated count, so they almost never trigger.
- **Credits staked can't add up:** they're far more than the simulated traders hold in total (a few hundred traders).
- **Prices move too much for the volume shown:** one trade moves the price by the real amount, so hundreds of "forecasts" move it less than the count suggests.
- **Admin pages disagree with public pages:** an admin market page shows the real count (for example 50) while the public page shows 1,100.
- **Real users' trades get multiplied too:** turn this off before real users trade.

## Before anything beyond the demo

1. Set `DEMO_INFLATE_COUNTS=false`, or remove `lib/demo-scale.ts` and its call sites.
2. Don't quote these counts in the pitch deck or video as real activity. They're simulated.
