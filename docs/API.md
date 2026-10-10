# Backend contracts

This is what Felix, Darsh, and Sahil can build on. If something you need is missing, or the schema needs a change, tell Kyler rather than working around it.

## Response format

Every route returns one of these:

```json
{ "data": ..., "meta": { "nextCursor": "abc", "limit": 20 } }
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "details": [{ "path": "closesAt", "message": "..." }] } }
```

Error codes and statuses: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `CONFLICT` / `INSUFFICIENT_CREDITS` / `INVALID_STATE` 409, `INTERNAL_ERROR` 500.

Lists use cursor pagination. Pass `meta.nextCursor` back as `?cursor=`, and `limit` goes up to 100.

To build a route the same way, wrap it in `withApiHandler`, check the caller with `requireUser()`, validate input with `parseJsonBody(req, schema)`, and return `ok(data)` or `created(data)`. Any `ApiError`, Zod error, or Prisma error thrown inside turns into the right response for you.

## Endpoints

Users (signed in)

- `GET /api/users/me` returns your profile, credit balance, and org memberships
- `PATCH /api/users/me` takes `{ displayName?, username?, bio?, avatarUrl? }`
- `GET /api/users/me/credits` returns your balance plus your ledger, newest first
- `GET /api/users/me/notifications?unread=true` and `PATCH` with `{ ids: [...] | "all" }` to mark them read
- `GET /api/users/:username` is a public profile with no email or balance
- `POST /api/users/webhooks/clerk` is Clerk's webhook (signature checked)

Organizations (members only, and non-members get 404)

- `GET /api/organizations` lists your orgs. `POST` creates one and makes you OWNER.
- `GET|PATCH|DELETE /api/organizations/:orgId`. PATCH needs ADMIN, DELETE needs OWNER.
- `GET|POST /api/organizations/:orgId/members`. POST takes `{ email, role }` and needs ADMIN. Inviting an email that doesn't have an account yet creates a pending member, who gets linked up when they first sign in with that verified email.
- `PATCH|DELETE /api/organizations/:orgId/members/:userId`. Admins can only manage analysts and viewers, and there always has to be at least one owner. Delete your own membership to leave.

Admin (platform admins only)

- `GET|POST /api/admin/startups`, `GET|PATCH /api/admin/startups/:id`
- `GET|POST /api/admin/startups/:id/facts` with `{ label, value, sourceName, sourceUrl, asOf, verified? }`, and `PATCH|DELETE /api/admin/facts/:factId`. Send `{ verified: true }` to mark a fact checked.
- `GET|POST /api/admin/news`, `GET|PATCH|DELETE /api/admin/news/:id`. `verification` is `UNVERIFIED` (the default), `VERIFIED`, or `DISPUTED`.
- `GET|POST /api/admin/markets`, `GET|PATCH /api/admin/markets/:id`. A market needs `yesCriteria`, `noCriteria`, and at least one entry in `sources` (`{ title, url }`). `openingBaseline` is optional, but if you set it you also need `baselineMethodology`.
- `POST /api/admin/markets/:id/status` with `{ status: "OPEN" | "CLOSED" | "CANCELLED" }`
- `POST /api/admin/markets/:id/resolve` with `{ outcome: "YES" | "NO" | "VOID", evidenceSummary, evidenceUrls: [...] }`
- `POST /api/admin/credits` with `{ userId, amount, type: "ADMIN_GRANT" | "ADMIN_ADJUSTMENT", memo, idempotencyKey }`
- `GET /api/admin/users?q=`, `PATCH /api/admin/users/:id` with `{ platformRole }`, `GET /api/admin/users/:id/ledger`
- `GET /api/admin/audit-logs`
- `GET /api/admin/cron/close-markets` is for Vercel Cron and needs `Authorization: Bearer $CRON_SECRET`

The `/admin` pages call the same functions in `lib/admin.ts`.

## Market lifecycle

`DRAFT → OPEN ⇄ CLOSED → RESOLVED`, and a market can be `CANCELLED` from any of those. Some rules:

- Opening a market writes `MarketSnapshot` #1 with trigger `OPENING`.
- Once a market has forecasts, its question, criteria, baseline, startup, visibility, and open time can't be changed.
- You can only cancel a market with a status change if nobody has forecast on it. Otherwise resolve it as `VOID` so people get their stakes back.
- Resolving needs a written summary plus at least one evidence link. It notifies the forecasters, writes to the audit log, and creates a `Resolution` with `settlementStatus: PENDING`. Each market can only be resolved once.
- The cron moves OPEN markets to CLOSED after `closesAt`, but forecast submission should still check `closesAt > now` itself.

Visibility is `PUBLIC`, `ORGANIZATION` (members of `Market.organization`), or `RESTRICTED` (that org's owners and admins, plus the study author and the people invited to the study). Non-public markets come from research studies.

## Felix: forecasting and settlement

The schema now has the fields your ports use. Here's how they map:

| Your type | Database |
|---|---|
| `Market.companyId` | `Market.startupId` |
| `Market.openingBaseline` (value, asOf, modelVersion, inputsNote) | `openingBaseline`, `baselineSetAt`, `baselineMethodology` |
| `Market.model` | `modelValue`, `modelUpdatedAt`, `modelVersion`, `modelInputsNote` |
| `minAmount` / `maxAmount` | `minForecastCredits` / `maxForecastCredits` |
| `Forecast.amount` | `Forecast.credits` |
| `sequence`, `requestHash`, `verifiedAtEntry`, `entry`, `fill` | same names (`entry` and `fill` are JSON) |
| `MarketSnapshot` | `MarketSnapshot`. `general` and `specialized` map to `generalEstimate` and `specializedEstimate`. `generalForecasters` maps to `forecasterCount`, and the `generalAmount` total is `yesCredits + noCredits`. |
| `SettlementRecord` | `Resolution` (`settlementStatus`, `settlementModelId`, `settledAt`) plus `Forecast.payout` / `settledAt` |
| `Outcome` `VOID` | `ResolutionOutcome.VOID` |

Use `db` from `lib/db.ts` in your `ForecastRepository` adapter. For `LockManager`, use `SELECT ... FOR UPDATE` on the market row inside the same transaction. `(userId, idempotencyKey)` and `(marketId, sequence)` are both unique.

`CreditLedger` adapter. `applyCreditTransaction(tx, input)` in `lib/credits.ts` does atomic, idempotent debits and credits inside your transaction, and throws `INSUFFICIENT_CREDITS` when the balance is too low. Your keys work as they are. Use these transaction types:
- `forecast:<id>` → `FORECAST_STAKE`
- `forecast-reversal:<id>` → `FORECAST_REVERSAL`
- `settlement:<marketId>:<forecastId>` → `SETTLEMENT_PAYOUT`, or `MARKET_REFUND` for VOID outcomes

You can put the debit and the forecast insert in one transaction, so you no longer need the compensating refund.

Settlement. Implement `SettlementService.settleResolution(resolutionId)` from `lib/types.ts`:

1. Call `claimResolutionForSettlement(id)`. If it returns false, someone else already has it, so stop.
2. Pay out with the keys above. Because of them, re-running settlement after a crash never pays anyone twice.
3. Mark the forecasts `SETTLED` or `REFUNDED`, then call `completeResolutionSettlement(id)`. If something fails, call `failResolutionSettlement(id, message)`. Failed resolutions can be claimed again.

Once your service exists, Kyler will call it from the resolve route. The seed includes two resolved markets and one void one, all still `PENDING`, for you to test against. `SettlementAuthorizer` is the resolve route itself, which only platform admins can reach. Nothing exists for `TraderDirectory` (verified users of a product) yet, so leave `verifiedAtEntry` false for now.

## Darsh: VC intelligence

Your schema request is merged, with every relation wired to the real tables. Differences from the request:

- No `Market.studyId`. The link is `ResearchStudy.marketId`, as in your request, and `market.study` is available as a back-relation.
- `ResolvedOutcome` became the shared `ResolutionOutcome` enum (`YES | NO | VOID`, same values).
- `Market.visibility` uses `MarketVisibility`, which has the same values as `StudyVisibility`.

Changes for `platform-adapter.ts`:

| You expected | Actual |
|---|---|
| `prisma` from `@/lib/db` | `db` |
| `getCurrentUser()` → `{ name, role }` | `{ displayName, platformRole }` |
| `prisma.organizationMember` | `db.organizationMembership` |
| `user.name` | `user.displayName` |
| `startup.industry` | `startup.industry` (unchanged) |
| `createMarketForStudy` from `@/lib/admin/markets` | `createMarketForStudy` from `@/lib/admin` |

When a study is closed early, call `closeMarketForStudy({ studyId, closedById, reason? })` from `@/lib/admin` in the same step so forecasting stops. It's safe to call twice and returns null if the study never opened a market.

`createMarketForStudy(input)` takes your `CreateMarketForStudyInput` unchanged and returns the market (use `.id`). It's idempotent on `studyId` and safe to call concurrently. It checks that the study is `APPROVED` or `OPEN` and that the org and startup match. It does not write to the study, so set `ResearchStudy.marketId` in your open transition. Restricted-market visibility depends on that link.

Use `requireOrgRole` from `lib/permissions.ts` for org checks. Study and watchlist rules are yours in `lib/vc/permissions.ts`. Record changes to org data with `recordAudit(...)` from `lib/audit.ts`. For the cron, add your path to `vercel.json` next to the existing one.

## Sahil: public pages and read APIs

The schema now uses your names where we overlapped: `Startup.industry`, `Startup.websiteUrl`, `StartupFact`, `MarketSource`, `MarketSnapshot`, `NewsItem.url` / `publisher`, `Market.yesCriteria` / `noCriteria`, and `VOID`. Differences:

- Import `db` from `@/lib/db` (there's no `prisma` export), and delete your `prisma/schema.prisma` and `lib/db.ts`.
- `MarketSnapshot.recordedAt`, `allocationShare`, and `forecasterCount` match yours. There's also a `sequence` you can order by.
- Market resolution lives in the `Resolution` relation (`market.resolution.outcome`, `evidenceSummary`, `evidenceUrls`, `resolvedAt`), not in columns on `Market`.
- `Market.baselineMethodology` is the same thing as your `baselineMethod`.
- `NewsItem.verification` is `VERIFIED`, `UNVERIFIED`, or `DISPUTED`, and `StartupFact.verified` is true only once an admin has checked the source. Label them that way. Admins manage both at `/admin/news` and on each startup's admin page, and every verification change is audit-logged.

Every public query needs to use `PUBLIC_MARKET_WHERE` and `PUBLIC_STARTUP_WHERE` from `lib/permissions.ts`. That keeps drafts, unpublished startups, and VC markets off public pages.

Show these as separate, labelled numbers:
- the opening baseline (`openingBaseline` with its methodology)
- the community allocation share (`yesCredits / (yesCredits + noCredits)`, never called a probability)
- the calibrated probability (`MarketSnapshot.calibratedProbability`, only when Felix provides it)

`lib/types.ts` re-exports every enum and model type, and it's safe to import from client components.

## Environment variables

See `.env.example`. The required ones are `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`. Optional ones: `TEST_DATABASE_URL`, `CLERK_WEBHOOK_SIGNING_SECRET`, `SENZI_ADMIN_EMAILS`, `SEED_DEMO_EMAIL`, and `CRON_SECRET`.
