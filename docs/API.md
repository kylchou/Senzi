# Backend contracts

This is what Felix, Darsh, and Sahil can build on. If something you need is missing, or the schema needs a change, tell Kyler rather than working around it.

## Response format

Every route returns one of these:

```json
{ "data": ..., "meta": { "nextCursor": "abc", "limit": 20 } }
{ "error": { "code": "VALIDATION_ERROR", "message": "Invalid request", "details": [{ "path": "closesAt", "message": "..." }] } }
```

Error codes and statuses: `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VALIDATION_ERROR` 400, `CONFLICT` / `INSUFFICIENT_CREDITS` / `INVALID_STATE` 409, `RATE_LIMITED` 429 (with a `Retry-After` header), `INTERNAL_ERROR` 500.

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
- `POST /api/admin/markets/:id/resolve` proposes an outcome: `{ outcome, voidReason?, evidenceSummary, evidence: [{ title, url, sourceType?, license?, publisher?, publishedAt? }] }`. A different admin then approves it.
- `GET /api/admin/resolution-proposals?status=PROPOSED` is the review queue. `POST /api/admin/resolution-proposals/:id/approve` takes `{ note? }`, and `.../reject` takes `{ reason }`. The proposer can reject their own proposal to withdraw it.
- `POST /api/admin/resolutions/:id/corrections` takes the same body as a proposal, plus `correctionReason`. `POST /api/admin/resolutions/:id/settle` runs or retries settlement.
- `POST /api/admin/credits` with `{ userId, amount, type: "ADMIN_GRANT" | "ADMIN_ADJUSTMENT", memo, idempotencyKey }`
- `GET /api/admin/users?q=`, `PATCH /api/admin/users/:id` with `{ platformRole }`, `GET /api/admin/users/:id/ledger`
- `GET /api/admin/audit-logs`
- `GET /api/admin/cron/close-markets` is for Vercel Cron and needs `Authorization: Bearer $CRON_SECRET`. It closes expired markets, retries settlements that are pending, failed, or stuck, and prunes old rate-limit counters.

The `/admin` pages call the same functions in `lib/admin.ts`.

## Market lifecycle

`DRAFT → OPEN ⇄ CLOSED → RESOLVED`, and a market can be `CANCELLED` from any of those. Some rules:

- Opening a market writes `MarketSnapshot` #1 with trigger `OPENING`.
- Once a market opens, its terms are locked: question, criteria, baseline, startup, visibility, sources, slug, and credit limits. Only the description, category, deadline, and resolve-by date can change after that, and the audit log records the old and new value of every change.
- You can only cancel a market with a status change if nobody has forecast on it. Otherwise resolve it as `VOID` so people get their stakes back.
- The cron moves OPEN markets to CLOSED after `closesAt`, but forecast submission should still check `closesAt > now` itself.

### Resolving a market

1. One admin proposes an outcome with evidence. Each piece of evidence records its source type, license, publisher, publish date, and retrieval time. The market closes to new forecasts while the proposal waits.
2. A different admin approves it or rejects it. Proposing and approving your own resolution is refused, unless `SENZI_ALLOW_SELF_APPROVAL=true` is set outside production (local dev and tests only).
3. Approval creates the `Resolution`, sets the market to `RESOLVED` (or `CANCELLED` for VOID), notifies forecasters, and starts settlement. Each market has one resolution.

VOID covers every case where a market can't be fairly answered. It needs a `voidReason`, refunds every stake, and marks the market `CANCELLED`. The reasons:
- `CANCELLED`: the question stopped applying, e.g. the company was acquired first.
- `AMBIGUOUS`: the criteria can't decide the outcome as written.
- `UNVERIFIABLE`: the evidence needed doesn't exist or isn't accessible.
- `INVALID_MARKET`: the market was set up wrong.
- `OTHER`.

Corrections use the same propose and approve flow, and they need a reason. Evidence and wording can be corrected at any time. The outcome can only change while settlement is `PENDING` or `FAILED`. Once credits have moved, changing it would mean reversing payouts, which the forecasting engine doesn't support yet. Proposals and evidence can never be edited or deleted (the database enforces this), so a market's whole decision history stays readable, and `Resolution.currentProposalId` points to the version in effect.

### Sources and provenance

Market sources, startup facts, news, and resolution evidence all record:
- **`license`**: what we may do with the content. It defaults to `LINK_ONLY` (link and cite, don't copy), because a public web page isn't automatically licensed for reuse.
- **`retrievedAt`**: when we read the source.
- **`sourceType`** (on everything except news): company announcement, filing, news report, and so on.

Facts and news also record who verified them and when (`verifiedById`, `verifiedAt`). Seeded companies have `isDemo: true`, and none of their facts or news are marked verified.

### Rate limits

`rateLimit(key, rule)` in `lib/rate-limit.ts` is a fixed-window limiter stored in Postgres, so it holds across serverless instances. It already guards:
- creating orgs: 5 an hour
- invites: 30 an hour
- profile edits: 30 an hour
- credit adjustments: 60 an hour
- resolution actions: 60 an hour

`RATE_LIMITS.forecastSubmit` (60 a minute) is there for Felix's submit route, and `RATE_LIMITS.export` (30 an hour) is for Darsh's exports. Use `rateLimitByIp` for routes that don't require sign-in.

## Who can do what

Everything here is enforced on the server; hiding a button is never the access control.

| | Read | Create / update | Export | Administer |
|---|---|---|---|---|
| Signed out | Public markets, published startups, facts, news | Nothing | Nothing | Nothing |
| Signed-in user | The above, plus their own profile, credits, notifications | Their profile; forecasts (Felix's route) | Their own ledger | Nothing |
| Org VIEWER | Their org's markets, org-wide studies, watchlists, alerts | Nothing in the org | Nothing | Nothing |
| Org ANALYST | Same as viewer | Studies (as author), notes, watchlists, reports | Reports for studies they can see | Nothing |
| Org ADMIN | Everything in the org, including restricted studies | Same as analyst | Org reports | Add, remove, and change analysts and viewers |
| Org OWNER | Everything in the org | Same as admin | Org reports | All members, including admins and owners; delete the org. There's always at least one owner. |
| Platform ADMIN | Admin tools; never another firm's private org data | Startups, markets, facts, news, credit adjustments, user roles | Audit log | Propose, approve, and correct resolutions (never approving their own); review studies |

Restricted studies (and their markets) are visible to the org's owners and admins, the author, and invited participants, even when those participants are outside the org. Darsh's `lib/vc/permissions.ts` has the exact study rules. Non-members get `404`, never `403`, so private things don't reveal that they exist.

Visibility is `PUBLIC`, `ORGANIZATION` (members of `Market.organization`), or `RESTRICTED` (that org's owners and admins, plus the study author and the people invited to the study). Non-public markets come from research studies.

## Felix: forecasting and settlement

**Team decision (2026-10-09):** the community estimate is the credit allocation share (YES credits ÷ all credits), and payouts are pari-mutuel. Winners get their stake back plus a share of the losing side's credits, split in proportion to their stakes and rounded down to whole credits. VOID refunds every stake. These go into your `CommunityEstimateRule` and `SettlementModel`. Any credits lost to rounding just stay unpaid.

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

`CreditLedger`: done. `createCreditLedger()` in `lib/credit-ledger.ts` implements your port on top of the real ledger. Pass it a transaction client (`createCreditLedger(tx)`) to put the debit and the forecast insert in one transaction, so a failed insert rolls the stake back without the compensating refund. It accepts exactly the reasons your engine uses and records them as:
- `forecast_stake` → `FORECAST_STAKE`
- `forecast_stake_reversal` → `FORECAST_REVERSAL`
- `forecast_payout` → `SETTLEMENT_PAYOUT`
- `forecast_refund_void` → `MARKET_REFUND`

It throws your `InsufficientBalanceError`, and `ForecastingError("IDEMPOTENCY_CONFLICT")` if a key is reused with a different amount. Any other reason is rejected. The `reference` you pass is stored in the ledger memo.

Model tables: done, as proposed in `docs/model-schema-proposal.md`. `ModelDataPoint`, `ModelQuestionSpec`, `ModelBaselineSnapshot` and `ModelRun` exist, along with the rules from the proposal:
- provenance is tied to source and org;
- periods have to be in order;
- probabilities stay between 0 and 1;
- the question's resolution source locks once the market opens (a database trigger).

The data point unique key is `NULLS NOT DISTINCT`, so scraped rows dedupe even with no org. Kept `resolutionSourceUrl` on the spec, because the machine-checkable source should stay locked separately from the market's display sources. Read sponsor data with `visibleModelDataPointsWhere(userId)` from `lib/permissions.ts`. `SEC_USER_AGENT`, `GITHUB_TOKEN`, and the `scrape` / `model:*` npm scripts are added. Before anyone runs the SEC collector, the team still needs to pick a real contact email for `SEC_USER_AGENT`.

Settlement. `lib/settlement.ts` already runs the state machine: claiming a resolution, completing it or marking it failed, retrying, and recovering attempts that got stuck after 10 minutes. It runs right after a resolution is approved, from the admin "Run settlement now" button, and from the cron. You provide one function:

```ts
type SettleFn = (input: { resolutionId; marketId; outcome: "YES" | "NO" | "VOID"; resolvedAt }) => Promise<{ settlementModelId?: string } | void>;
```

It should pay out every forecast through `createCreditLedger()` with your `settlement:<marketId>:<forecastId>` keys, mark forecasts `SETTLED` or `REFUNDED`, and throw on failure. Those keys make retries safe. When it's ready, set `forecastingSettle` at the top of `lib/settlement.ts` to your function; that's a one-line PR. The seed includes two resolved markets and one void one, all still `PENDING`, to test against. `SettlementAuthorizer` is the resolve route itself, which only platform admins can reach. Nothing exists for `TraderDirectory` (verified users of a product) yet, so leave `verifiedAtEntry` false for now.

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
- Market resolution lives in the `Resolution` relation (`market.resolution.outcome`, `voidReason`, `evidenceSummary`, `evidenceUrls`, `resolvedAt`), not in columns on `Market`. It only exists once a second admin has approved it.
- `Startup.isDemo` marks fictional demo companies. Please show a visible "Demo" label wherever they appear.
- `Market.baselineMethodology` is the same thing as your `baselineMethod`.
- `NewsItem.verification` is `VERIFIED`, `UNVERIFIED`, or `DISPUTED`, and `StartupFact.verified` is true only once an admin has checked the source. Label them that way. Admins manage both at `/admin/news` and on each startup's admin page, and every verification change is audit-logged.

Every public query needs to use `PUBLIC_MARKET_WHERE` and `PUBLIC_STARTUP_WHERE` from `lib/permissions.ts`. That keeps drafts, unpublished startups, and VC markets off public pages.

Show these as separate, labelled numbers:
- the opening baseline (`openingBaseline` with its methodology)
- the community allocation share (`yesCredits / (yesCredits + noCredits)`, never called a probability)
- the calibrated probability (`MarketSnapshot.calibratedProbability`, only when Felix provides it)

`lib/types.ts` re-exports every enum and model type, and it's safe to import from client components.

## Environment variables

See `.env.example`. The required ones are `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `CLERK_SECRET_KEY`. Optional ones: `TEST_DATABASE_URL`, `CLERK_WEBHOOK_SIGNING_SECRET`, `SENZI_ADMIN_EMAILS`, `SEED_DEMO_EMAIL`, `CRON_SECRET`, `SEC_USER_AGENT`, `GITHUB_TOKEN`, and `SENZI_ALLOW_SELF_APPROVAL` (dev only).
