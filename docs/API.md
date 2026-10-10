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
- `GET|POST /api/admin/markets`, `GET|PATCH /api/admin/markets/:id`
- `POST /api/admin/markets/:id/status` with `{ status: "OPEN" | "CLOSED" | "CANCELLED" }`
- `POST /api/admin/markets/:id/resolve` with `{ outcome: "YES" | "NO" | "CANCELLED", evidenceSummary, evidenceUrls: [...] }`
- `POST /api/admin/credits` with `{ userId, amount, type: "ADMIN_GRANT" | "ADMIN_ADJUSTMENT", memo, idempotencyKey }`
- `GET /api/admin/users?q=`, `PATCH /api/admin/users/:id` with `{ platformRole }`, `GET /api/admin/users/:id/ledger`
- `GET /api/admin/audit-logs`
- `GET /api/admin/cron/close-markets` is for Vercel Cron and needs `Authorization: Bearer $CRON_SECRET`

The `/admin` pages call the same functions in `lib/admin.ts`.

## Market lifecycle

`DRAFT → OPEN ⇄ CLOSED → RESOLVED`, and a market can be `CANCELLED` from any of those. Some rules:

- Opening a market records an `OPENING` snapshot that holds the admin's baseline.
- Once a market has forecasts, its question, criteria, baseline, startup, visibility, and open time can't be changed.
- You can only cancel a market with a status change if nobody has forecast on it. Otherwise resolve it as `CANCELLED` so people get their stakes back.
- Resolving needs a written summary plus at least one evidence link. It notifies the forecasters, writes to the audit log, and creates a `Resolution` with `settlementStatus: PENDING`. Each market can only be resolved once.
- The cron moves OPEN markets to CLOSED after `closesAt`, but forecast submission should still check `closesAt > now` itself.

## Felix: forecasting and settlement

Submitting a forecast. Validate the body with `forecastSubmissionSchema` from `lib/validation.ts`, then do this in one `db.$transaction`:

1. Check the market is visible (`requireMarketVisible`), `OPEN`, and still before `closesAt`.
2. Create the `Forecast` with the client's `idempotencyKey` (unique per user).
3. Call `applyCreditTransaction(tx, { userId, amount: -credits, type: "FORECAST_STAKE", idempotencyKey: "forecast:<forecastId>", marketId, forecastId })`. It throws `INSUFFICIENT_CREDITS` if the user can't cover it, and the whole transaction rolls back.
4. Increment `Market.yesCredits` / `noCredits` / `forecastCount` and write a `ProbabilitySnapshot` (trigger `FORECAST`).

Settling a resolution. Implement `SettlementService.settleResolution(resolutionId)` from `lib/types.ts`:

1. Call `claimResolutionForSettlement(id)`. If it returns false, someone else already has it, so stop.
2. Pay out with `applyCreditTransaction` using type `SETTLEMENT_PAYOUT` and key `settlement:<resolutionId>:<forecastId>`. For `CANCELLED` outcomes use `MARKET_REFUND` and `refund:<resolutionId>:<forecastId>`. Because of those keys, re-running settlement after a crash never pays anyone twice.
3. Mark the forecasts `SETTLED` or `REFUNDED`, then call `completeResolutionSettlement(id)`. If something fails, call `failResolutionSettlement(id, message)`. Failed resolutions can be claimed again.

Once your service exists, Kyler will call it from the resolve route. Credits are whole numbers, so round payouts down. The seed includes two resolved markets and one cancelled one, all still `PENDING`, for you to test against.

## Darsh: VC intelligence

- Use `requireOrgRole(user, orgId, minRole)` for org pages, and `requireStudyAccess(user, studyId, "read" | "edit" | "manage")` for studies.
- For lists, filter with `readableStudiesWhere(userId)`, so restricted studies only show up for their members and org admins.
- `requireWatchlistAccess(user, watchlistId, "read" | "write")` covers both personal and org watchlists.
- `visibleMarketsWhere(userId)` includes the private markets of the user's orgs.
- Record anything that changes org data with `recordAudit(...)` from `lib/audit.ts`.
- The data models are `ResearchStudy`, `StudyMembership`, `StudyStartup`, `StudyMarket`, `Watchlist`, and `WatchlistItem` (`alertThreshold` is a 0–1 move in the allocation share). If reports or alerts need their own tables, ask.

## Sahil: public pages and read APIs

- Every public query needs to use `PUBLIC_MARKET_WHERE` and `PUBLIC_STARTUP_WHERE` from `lib/permissions.ts`. Use `DIRECT_LINK_MARKET_WHERE` when someone opens a market by its slug, so unlisted markets work by link. Together these keep drafts, unpublished startups, and private VC markets out of public pages.
- Show the three measurements under their own labels: opening baseline (`Market.openingBaseline`), community allocation share (`yesCredits / (yesCredits + noCredits)`), and calibrated probability (`ProbabilitySnapshot.calibratedProbability`, filled in by Felix).
- `NewsItem.verification` tells you whether the facts were checked (`VERIFIED`) or are just reported (`UNVERIFIED`), so label them that way.
- `lib/types.ts` re-exports every enum and model type, and it's safe to import from client components.

## Environment variables

See `.env.example`. The required ones are `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`. Optional ones: `TEST_DATABASE_URL`, `CLERK_WEBHOOK_SIGNING_SECRET`, `SENZI_ADMIN_EMAILS`, `SEED_DEMO_EMAIL`, and `CRON_SECRET`.
