# VC Intelligence

Private research workspace for venture capital firms: research studies, watchlists, alerts, dashboards and reports.

Owned paths: `app/vc/**`, `components/vc/**`, `lib/vc/**`, `app/api/studies/**`, `app/api/vc/**`.

VentureCast estimates are research signals from virtual-credit forecasts. They are not guaranteed predictions or investment advice. No real money is involved.

## Architecture

```
app/vc/**, app/api/**  →  lib/vc/server/*   (auth context, HTTP helpers, wiring)
                       →  lib/vc/services/* (business rules, permission checks)
                       →  lib/vc/ports.ts   (interfaces)
                             ├─ server/prisma-repository.ts   VC-owned tables
                             ├─ server/platform-adapter.ts    
                             └─ server/forecasting-adapter.ts
```

Pure logic (`lifecycle.ts`, `permissions.ts`, `estimates.ts`, `reports.ts`, `validation.ts`) has no framework dependencies and is unit-tested with in-memory ports (`testing/memory.ts`).

## Integration contracts

### schema, auth, organizations, markets

Schema: the requested models are in [`schema-request.prisma`](./schema-request.prisma). They are not merged into `prisma/schema.prisma`; The request also asks for `Market.studyId` (unique) and `Market.visibility`.

Modules `platform-adapter.ts` expects (change the adapter if the real names differ):

| Import | Expected shape |
|---|---|
| `@/lib/db` | `export const prisma: PrismaClient` |
| `@/lib/auth` | `getCurrentUser(): Promise<{ id, name, email, role: "USER" \| "ADMIN" } \| null>` |
| `@/lib/admin/markets` | `createMarketForStudy(input: CreateMarketForStudyInput): Promise<{ id: string }>`. Must be idempotent on `input.studyId` |
| Prisma models | `organizationMember { userId, organizationId, role, createdAt, organization { id, name } }`, `user { id, name, email }`, `startup { id, name, slug, industry }`, `market { id, startupId, question, status, closesAt, visibility }` |

Organization roles map to `OWNER | ADMIN | ANALYST | VIEWER`. Any unknown role is treated as `VIEWER` (read-only). Platform staff with `role === "ADMIN"` act as study reviewers.

Public market APIs must exclude markets whose `visibility !== "PUBLIC"`. Those markets belong to private studies.

### forecasting

`forecasting-adapter.ts` expects:

| Import | Expected shape |
|---|---|
| `@/lib/probability` | `getMarketEstimates(marketIds: string[]): Promise<MarketEstimate[]>` |
| `@/lib/forecasting` | `getMarketHistory(marketId, { from?, to? }): Promise<EstimatePoint[]>` |

`MarketEstimate` and `EstimatePoint` are defined in [`types.ts`](./types.ts). VC Intelligence never recomputes allocation shares or settlement. It only compares snapshots.

For forecast submission: call `getStudyMarketAccess(marketId, userId)` from `lib/vc/server/market-access.ts`. It returns `canForecast` for markets that came from ORGANIZATION or RESTRICTED studies.

### Measurement vocabulary

These three values are always shown separately and labelled:

- Opening baseline: a reference value with a documented methodology, set before forecasting starts.
- Community YES credit-allocation share: YES credits ÷ total credits. It is never called a probability.
- Calibrated probability: shown only when provided `calibratedProbability`. Otherwise the UI shows "Not available".

## Study lifecycle

`DRAFT → SUBMITTED → APPROVED → OPEN → CLOSED → RESOLVED`. The side branches are `REJECTED` (which can be revised back to `DRAFT`) and `CANCELLED` (allowed only before the study opens).

| Action | Who |
|---|---|
| submit, withdraw, revise | the study author (ANALYST or above) or an org OWNER/ADMIN |
| approve, reject, open | platform admin (a firm cannot publish its own question without review) |
| close | platform admin, or the system when the deadline passes |
| resolve | system only, mirroring the market resolution recorded |
| cancel | author, org manager or platform admin, before the study opens |

Every transition uses a compare-and-set on `version` and writes a `StudyEvent` audit row in the same transaction.

## Access model

| Viewer | PUBLIC | ORGANIZATION | RESTRICTED |
|---|---|---|---|
| Firm OWNER/ADMIN, author | full | full | full |
| Other firm members | full | full | none, unless invited |
| Invited external participant | limited (once published) | none | limited (once published) |
| Other firms / signed-in users | limited (once published) | none | none |
| Platform admin | limited (from SUBMITTED onward) | limited | limited |

Full access includes private notes, saved reports, exports, the participant list and the attributed timeline. Limited access shows only the question, criteria, sources, baseline and estimates. If a caller has no access, the API returns `404`, so it never reveals whether a study exists. Alerts and saved reports are checked again against the study's current permissions every time they are read.

## HTTP API

Every response uses the envelope `{ "data": … }` or `{ "error": { "code", "message", "details"? } }` and is sent with `Cache-Control: private, no-store`. Mutating requests from another origin are rejected. To pick the active organization, pass `?orgId=` or the `x-vc-org-id` header. Without either, the `vc_org` cookie is used, and failing that, the user's first membership.

| Method & path | Body / query | Notes |
|---|---|---|
| `GET /api/studies` | `?scope=organization\|public\|participating&status=` | |
| `POST /api/studies` | `CreateStudyInput` | creates a DRAFT; `201` |
| `GET /api/studies/review-queue` | | platform admins only |
| `GET /api/studies/:id` | | detail, permissions, estimate, history, events |
| `PATCH /api/studies/:id` | partial fields + `expectedVersion` | drafts only; `409` if the version is stale |
| `POST /api/studies/:id/transitions` | `{ action, reason?, expectedVersion }` | |
| `PUT /api/studies/:id/participants` | `{ userIds?, emails? }` | replaces the list |
| `GET/POST /api/studies/:id/notes` | `{ body }` | private to the firm |
| `DELETE /api/studies/:id/notes/:noteId` | | author or manager |
| `GET /api/studies/:id/report` | `?format=json\|markdown\|csv` | live report, owning firm only |
| `GET /api/vc/dashboard` | | |
| `GET/POST /api/vc/watchlists` | `{ name }` | |
| `DELETE /api/vc/watchlists/:id` | | |
| `POST /api/vc/watchlists/:id/items` | `{ type: "STARTUP", startupId }` or `{ type: "STUDY", studyId }` | idempotent |
| `DELETE /api/vc/watchlists/:id/items/:itemId` | | |
| `GET /api/vc/alerts` | `?unreadOnly=true&type=&limit=` | |
| `PATCH /api/vc/alerts` | `{ alertIds }` | marks the alerts read for the current user |
| `GET/POST /api/vc/reports` | `{ studyId, title? }` | saves a snapshot |
| `GET /api/vc/reports/:id` | `?format=` | |
| `GET /api/vc/startups` | `?q=` | startup lookup for forms |
| `POST /api/vc/active-org` | `{ organizationId }` | sets the `vc_org` cookie |
| `GET /api/vc/cron` | `Authorization: Bearer $CRON_SECRET` | syncs statuses with markets and generates alerts; idempotent |

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `CRON_SECRET` | yes, in production | Authorizes `GET /api/vc/cron`. If it is unset, the endpoint always returns `401`. |
| `NEXT_PUBLIC_SIGN_IN_URL` | no (default `/sign-in`) | Where signed-out users are redirected from `/vc`. |


Scheduling: please add `{ "path": "/api/vc/cron", "schedule": "*/15 * * * *" }`, or any interval up to hourly.

## Tests

Unit and service tests are in `lib/vc/__tests__/` (Vitest). They cover the study lifecycle, organization isolation, restricted studies, permission redaction, alert visibility and dedupe, report access and contents, watchlists, and validation. They use only the in-memory ports, so they run without a database. If the shared Vitest config limits which files it includes, it needs to cover `lib/**/*.test.ts`.
