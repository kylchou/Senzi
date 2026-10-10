# VC Intelligence

Private research workspace for venture capital firms: research studies, watchlists, alerts, dashboards and reports.

Owned paths: `app/vc/**`, `components/vc/**`, `lib/vc/**`, `app/api/studies/**`, `app/api/vc/**`.

Senzi estimates are research signals from virtual-credit forecasts. They are not guaranteed predictions or investment advice. No real money is involved.

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

The VC models live in `prisma/schema.prisma` (merged from this section's schema request). The two adapters are the only files that touch other sections' code. Names follow `docs/API.md`.

### Auth, organizations, startups, markets: `server/platform-adapter.ts`

| Uses | For |
|---|---|
| `getCurrentUser()` and `isPlatformAdmin()` from `@/lib/auth` | The session user. `displayName` is mapped to `name`; platform admins act as study reviewers. |
| `db.organizationMembership` (from `@/lib/db`) | Org memberships and roles (`OWNER \| ADMIN \| ANALYST \| VIEWER`) |
| `db.user`, `db.startup` | User and startup lookups. Startup search only returns published startups. |
| `PUBLIC_MARKET_WHERE` from `@/lib/permissions` | Public markets about watched startups |
| `createMarketForStudy()` from `@/lib/admin` | Opening a study. It is idempotent on `studyId`; the `open` transition then stores the market id in `ResearchStudy.marketId`. |

Market visibility for non-public studies is enforced by `visibleMarketsWhere` in `lib/permissions.ts`, which relies on that `ResearchStudy.marketId` link.

### Forecasting: `server/forecasting-adapter.ts`

Reads the aggregates the forecasting engine maintains: `Market.yesCredits / noCredits / forecastCount / openingBaseline / baselineMethodology`, the latest `MarketSnapshot` (`forecasterCount`, `calibratedProbability`), snapshot history (`allocationShare` ordered by `sequence`), and `Resolution` (outcome and evidence). VC Intelligence never recomputes forecasts or settlement. When the engine exposes read services, this file is the one place to switch over.

### Measurement vocabulary

These three values are always shown separately and labelled:

- Opening baseline: the model's estimate when forecasting opens (see "Opening line" below). Never typed in by a person.
- Community YES credit-allocation share: YES credits ÷ total credits. It is never called a probability.
- Calibrated probability: shown only when the latest `MarketSnapshot.calibratedProbability` is set. Otherwise the UI shows "Not available".

## Opening line (set by the model)

Firms type any YES/NO question. Nobody types odds: the opening price comes from the baseline model (`lib/model`, `computeDirectBaseline`).

1. **Link the question to a metric.** In the study form, "Estimate opening line" calls `POST /api/vc/opening-line`. If the firm hasn't picked a metric, the AI (Tyche's Meta model, `assistant/suggest-metric.ts`) proposes one of the startup's metrics, a threshold and a date. It only proposes: every field is checked against the metrics that exist, and the firm confirms with "Use this measurement". A linked question and its YES/NO criteria are reworded to exactly what the model priced, and its public resolution source is added to the study's sources. Only metrics with an independent public resolution source can be linked (today, weekly npm/PyPI downloads); a question about ARR or other firm-only KPIs gets "Not enough data".
2. **Firm figures (optional).** The firm enters its own figures once per company on the company page (`/vc/companies/[slug]`, `server/company-model.ts`, stored as sponsor-provided `ModelDataPoint` rows for that organization). Figures for the linked metric fill weeks public data doesn't cover. The ones used are recorded on `StudyModelEstimate.observations`. They're visible only to the owning firm, never written to market tables (`publicInputs()`), and never resolve the question.
3. **Not enough data.** If no metric measures the question, or there's too little history, the study is saved with `NOT_MEASURABLE` or `INSUFFICIENT_DATA`. It can be submitted and approved, but **opening is blocked** until the model can estimate it.
4. **Opening.** `open` re-runs the model with current data. The market is created at the model's probability (`lib/admin.ts createMarketForStudy`, which now requires the `model` block): the opening price, the first point of the model line, and a `ModelBaselineSnapshot` whose confidence sets the starting liquidity (low confidence → early forecasts move the price more).
5. **Refresh.** The cron (`openingLine.refreshOpenMarkets`) re-runs the model for open study markets and publishes changed estimates through the forecasting engine's `recordModelValue`. Before the first forecast this also moves the opening price; after it, only the model line moves.

Code: `services/opening-line.ts`, `model-estimate.ts` (pure, shared with the seed), `server/model-adapter.ts`, `opening-line.ts` (wording, confidence, redaction), `components/vc/OpeningLinePanel.tsx`.

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

**Outcome corrections:** admins can correct an approved resolution until credits are settled. The cron re-checks studies resolved in the last 90 days. If the market's outcome changed, the study's outcome is updated (status stays RESOLVED), a `correct_resolution` event is recorded, and the firm gets a "Study outcome corrected" alert.

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

Every response uses the shared envelope from `lib/api-response.ts` (`{ "data": … }` or `{ "error": { "code", "message", "details"? } }`, with the shared error codes) and is sent with `Cache-Control: private, no-store`. Mutating requests from another origin are rejected. To pick the active organization, pass `?orgId=` or the `x-vc-org-id` header. Without either, the `vc_org` cookie is used, and failing that, the user's first membership.

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
| `POST /api/vc/follows` | `{ type: "STARTUP", startupId }` or `{ type: "STUDY", studyId }` | follow; idempotent. Each firm has one watchlist, created on first follow |
| `DELETE /api/vc/follows` | same body | unfollow |
| `GET /api/vc/alerts` | `?unreadOnly=true&type=&limit=` | |
| `PATCH /api/vc/alerts` | `{ alertIds }` | marks the alerts read for the current user, and clears the matching inbox notifications |
| `GET /api/vc/compare` | `?startupIds=a,b[,c,d]` | side-by-side comparison of 2–4 published startups |
| `GET/POST /api/vc/reports` | `{ studyId, title? }` | saves a snapshot |
| `GET /api/vc/reports/:id` | `?format=` | |
| `GET /api/vc/startups` | `?q=` | startup lookup for forms |
| `POST /api/vc/active-org` | `{ organizationId }` | sets the `vc_org` cookie |
| `GET /api/vc/cron` | `Authorization: Bearer $CRON_SECRET` | syncs statuses with markets and generates alerts; idempotent |

## Alerts

All alerts go through one publisher (`services/alert-publisher.ts`). It writes the firm's alert feed, which is deduped per firm, and then copies each new alert into the personal inbox (the shared `Notification` table) of every member allowed to see it.

- **Who gets inbox copies:** the rules are in `alert-delivery.ts`. Alerts about restricted studies only reach people who can view them. Status changes only reach the study's author and the firm's owners and admins.
- **If delivery fails:** inbox delivery is best-effort, so a failure never blocks or undoes the alert itself.
- **Read state:** marking an alert read in VC also clears its inbox copy.
- **Where they show up:** the dashboard has an alerts panel with unread counts by type, and `/vc/alerts` filters by type and unread.
- **Not yet built:** configurable rules and triage (assign, acknowledge, resolve) need schema additions. See [`REQUESTS.md`](./REQUESTS.md).

## Startup comparison

`/vc/compare?ids=a,b` puts 2–4 published startups side by side:

- open questions, questions awaiting resolution, and resolved ones
- a track record: YES rate with a 95% interval, and Brier scores for the opening baseline and the final allocation share, scored with the forecasting engine's own `brierScore` / `wilsonInterval`
- public indicators

Each column only includes public markets, published PUBLIC studies, and studies the caller's firm can see. Indicators come from the model through `server/indicators-adapter.ts`, which uses scraped public data only, never sponsor-provided figures. Startups the model doesn't track show as "not tracked".

## AI research assistant

**Tyche** is the AI research assistant. It's a bubble in the bottom-right corner of every VC page ("Ask Tyche · AI assistant") that opens a small chat about the study or comparison on screen.

- **Provider:** Meta Model API, `muse-spark-1.3` (Standard tier, which Meta doesn't train on). The connection is in `server/meta-muse.ts`, using plain `fetch`, so there's no SDK dependency.
- **Flow:** `services/assistant.ts` builds the authorized evidence package, sends Tyche's instructions (`assistant/prompt.ts`) and the evidence, and checks every citation. If the check finds errors, it asks the model once to rewrite.
- **Route:** `POST /api/vc/assistant` is signed-in only, limited to 30 questions per user per hour (`lib/rate-limit.ts`), and audited as `assistant.ask`.
- **Widget:** `components/vc/Tyche.tsx`, mounted in `app/vc/layout.tsx`.
- **Setup:** set `SENZI_AI_ASSISTANT_API_KEY`. Without it, the bubble says Tyche isn't set up yet.
- **Eval:** `assistant/evals/` has 20 graded cases. Run them with `npx tsx --env-file=.env.local lib/vc/assistant/evals/run.ts`. Each case is a real request to the Meta Model API.

The design is in [`AI_RESEARCH_ASSISTANT.md`](./AI_RESEARCH_ASSISTANT.md). The foundation underneath Tyche:

- **Context builder** (`assistant/context.ts`, loaded by `services/assistant-context.ts`): builds one evidence package per question, for a study or a comparison. It reads through the same permission-checked services as the pages, so a package never holds anything the asker can't open. Every item has a stable id built from real records (`study:…#criteria-yes`, `snapshot:…`, `fact:…`, `news:…`), a kind, a date, a source link and a fixed caveat. Allocation-share items always carry "Not a calibrated probability".
- **Data tiers:** `standard` (the default) excludes restricted studies and private notes. `extended` includes them and needs explicit team approval. The tier is set with `VC_ASSISTANT_DATA_TIER`.
- **Conflict flags** (`assistant/flags.ts`): computed in code, not by a model, and added as items with links to the evidence they're about:
  - a large move on thin participation
  - a gap from the opening baseline or the calibrated probability
  - no participation
  - disputed or unverified-only evidence
  - a move that follows an unverified report
  - stale evidence
  - a near deadline with few forecasters
- **Key stats** (`assistant/stats.ts`): one computed item per study (`stats:<studyId>`) with exact derived numbers, so Tyche quotes them instead of doing arithmetic: the share's gap to the opening baseline, the change since the first snapshot and over 7 days, forecaster growth, days until forecasting closes, verified/unverified/disputed evidence counts, and how old the newest evidence is.
- **Citation checker** (`assistant/citations.ts`): checks an answer's `[[id]]` markers against the package.
  - Errors: unknown ids, percentages that don't match the cited evidence, and the allocation share called a probability.
  - Warnings: uncited claims, which are shown as "not from your data".
- **Renderer** (`assistant/render.ts`): the deterministic text form of a package, for the provider prompt.

## Environment variables

`SENZI_AI_ASSISTANT_API_KEY` (needed for Tyche): the Meta Model API key, in `.env.local` and the Vercel project settings. `SENZI_AI_ASSISTANT_MODEL` (optional) overrides the model. `VC_ASSISTANT_DATA_TIER` (optional): `standard` (default) or `extended`. Set it to `extended` only after the team approves sending restricted studies and private notes to an AI provider. Otherwise there are no new variables. `GET /api/vc/cron` uses the existing `CRON_SECRET`; without it the endpoint always returns `401`. It runs every 15 minutes from `.github/workflows/cron.yml`, with a daily Vercel backup at 06:00 UTC (see `vercel.json`).

## Tests

- `lib/vc/__tests__/` (unit project): the study lifecycle, organization isolation, restricted studies, permission redaction, alert visibility and dedupe, report access and contents, watchlists, and validation. They use the in-memory ports in `testing/memory.ts`, so they run without a database.
- `tests/integration/vc/` (integration project): the real adapters against Postgres. A study goes through review, opens a market via `createMarketForStudy`, takes a forecast, and resolves through `resolveMarket`. Market visibility is checked for each study visibility, along with cross-firm isolation, alert dedupe, and adapter field mapping.
