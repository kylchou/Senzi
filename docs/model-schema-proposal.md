# Model tables: schema proposal for Engineer 1

**Status:** proposal. Nothing here has been migrated. Until it is, the model reads and writes files under `data/model/` (see `lib/model/store.ts`).

The tables follow the conventions in `prisma/schema.prisma` on `dev`: `cuid()` string ids, camelCase fields, and relations to `Startup` and `Market`. They add four tables and three enums. Existing models are left alone.

## What the model needs to store

1. **Data points**, scraped or sponsor-provided, each with its source, period, and the time it became publicly available. The backtest depends on that last field. The npm index basket (`data/model/npm-index.jsonl`, about 16.5k daily rows for 12 packages) belongs to no startup: either make `startupId` optional, where null means a market-wide series, or keep the index in a separate table with the same columns minus `startupId`.
2. **Question specs** that make a market machine-resolvable: metric, threshold, and 7-day window.
3. **Baseline snapshots**: probability, band, inputs, sources and as-of time. A new row is written only when the inputs change.
4. **Run logs** for collection and backtests, so we can show where every number came from.

## Prisma

```prisma
enum ModelSource {
  NPM
  PYPISTATS
  GITHUB
  SEC_EDGAR
  GREENHOUSE
  ASHBY
  WORKABLE
  TRANCO
  HN_ALGOLIA
  SPONSOR
}

enum DataProvenance {
  SCRAPED
  SPONSOR_PROVIDED
}

enum BaselineStatus {
  OK
  INSUFFICIENT_DATA
  OBSERVED
}

/// One observed value for a startup metric.
model ModelDataPoint {
  id             String         @id @default(cuid())
  startupId      String
  /// e.g. "npm_downloads:@supabase/supabase-js", "open_jobs", "sponsor_arr"
  metricId       String
  source         ModelSource
  value          Float
  periodStart    DateTime       @db.Date
  periodEnd      DateTime       @db.Date
  /// When the value became publicly knowable. Backtests filter on this.
  availableAt    DateTime
  fetchedAt      DateTime
  sourceUrl      String
  provenance     DataProvenance
  /// True for made-up demo values. Always false for scraped data.
  simulated      Boolean        @default(false)
  note           String?
  /// Sponsor-provided rows only: the sponsor org that entered it (visibility scope).
  organizationId String?
  /// Sponsor-provided rows only.
  enteredById    String?
  createdAt      DateTime       @default(now())

  startup      Startup       @relation(fields: [startupId], references: [id], onDelete: Cascade)
  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  enteredBy    User?         @relation(fields: [enteredById], references: [id], onDelete: SetNull)

  /// Re-fetching the same period updates the row; snapshot metrics get one row per day.
  @@unique([startupId, metricId, source, periodStart, periodEnd, organizationId])
  @@index([startupId, metricId, periodEnd])
  @@index([availableAt])
}

/// Makes a Market machine-resolvable: "Will <metric> in the 7 days ending
/// <windowEnd> be at least <threshold>?"
model ModelQuestionSpec {
  id                  String      @id @default(cuid())
  marketId            String      @unique
  metricId            String
  threshold           Float
  /// Last day (inclusive, UTC) of the window.
  windowEnd           DateTime    @db.Date
  windowDays          Int         @default(7)
  /// Named before the market opens. Must not change after Market.opensAt.
  resolutionSource    ModelSource
  resolutionSourceUrl String
  createdAt           DateTime    @default(now())

  market Market @relation(fields: [marketId], references: [id], onDelete: Cascade)
}

/// A computed baseline. A new row is written only when inputsHash changes
/// (new data or a new model version). The latest row is the model line (chart 1).
model ModelBaselineSnapshot {
  id           String         @id @default(cuid())
  marketId     String
  status       BaselineStatus
  /// Null when status = INSUFFICIENT_DATA.
  probability  Float?
  low          Float?
  high         Float?
  /// "low" | "medium" | "high"
  confidence   String?
  asOf         DateTime
  /// Last day of data the result is based on.
  dataThrough  DateTime?      @db.Date
  modelName    String
  modelVersion String
  inputsHash   String
  /// Full `method.details`: mu, sigma, weeks used, horizon, forecast median and range, seed, ...
  method       Json
  /// [{ metricId, source, provenance, simulated, role, points, periodStart, periodEnd }]
  inputsUsed   Json
  /// [{ source, url, fetchedAt }]
  sources      Json
  missing      String[]
  notes        String[]
  createdAt    DateTime       @default(now())

  market Market @relation(fields: [marketId], references: [id], onDelete: Cascade)

  @@unique([marketId, inputsHash])
  @@index([marketId, createdAt])
}

/// Audit trail for collection and backtest runs.
model ModelRun {
  id           String    @id @default(cuid())
  /// "collect" | "backtest"
  kind         String
  modelVersion String?
  startedAt    DateTime  @default(now())
  finishedAt   DateTime?
  /// Collection report (counts, missing data, errors) or backtest results.
  report       Json

  @@index([kind, startedAt])
}
```

The back-relations (`Startup.modelDataPoints`, `Market.modelQuestionSpec`, `Market.modelBaselineSnapshots`, `Organization.modelDataPoints`, `User.modelDataPointsEntered`) need adding on the existing models.

## Rules the database should enforce

- **Sponsor data is private to the sponsor.** Rows with `provenance = SPONSOR_PROVIDED` are visible only to members of `organizationId`. Scraped rows are public.
- **Provenance must match the source.** `provenance = SCRAPED` requires `simulated = false` and `organizationId IS NULL`. `SPONSOR_PROVIDED` requires `source = SPONSOR` and `organizationId IS NOT NULL`. These can be CHECK constraints.
- **Sponsor rows never resolve a market.** The resolution worker reads only `SCRAPED` rows for the spec's metric.
- **The resolution source is locked once the market opens.** `ModelQuestionSpec.resolutionSource` and `resolutionSourceUrl` can't change after `Market.opensAt`. This fits naturally in the same place `Market` edits are already restricted.
- **Periods are ordered.** `periodEnd >= periodStart` and `availableAt >= periodStart`.

## Already covered by the schema on `dev`

Ky's team-integration migration already added the `Market` fields the model writes: `openingBaseline`, `baselineMethodology`, `baselineSetAt`, `modelValue`, `modelVersion`, `modelInputsNote` and `modelUpdatedAt`. `toMarketModelFields(result)` in `lib/model/index.ts` produces exactly those columns from a `BaselineResult`, so nothing else on `Market` needs to change.

`MarketSnapshot` already has `openingBaseline` and `modelValue`, so chart 1 can come from there. The tables above are only for what `Market` can't hold: the raw data points, the question's metric and threshold, the full baseline record (band, inputs, sources, method), and run logs.

`ModelQuestionSpec.resolutionSource` and `resolutionSourceUrl` overlap with `MarketSource` (title and URL). Ky's call: keep both, or drop these two columns and read the market's first `MarketSource`. The model needs the source *type* (npm, PyPI) to know how to resolve, which is why it's on the spec.

## Volumes

- **Data points:** about 1,400 daily points per npm package over the full history. The current demo set is about 13k rows across 6 companies and grows by about 15 rows per company per day.
- **Baseline snapshots:** at most one per market per day (when new daily data lands).
