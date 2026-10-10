# Community UI (Sahil)

Public Senzi pages: homepage, markets, market detail, startups, startup profiles, search, news, and the forecast panel. Setup and environment variables are in the README and `.env.example`; this UI needs nothing extra.

## Privacy rules

Every public query uses the shared filters from `lib/permissions.ts`:

| Where | Filter |
| --- | --- |
| Market listings, search, homepage, startup profiles, market pages by slug | `PUBLIC_MARKET_WHERE` |
| Startup listings and profiles | `PUBLIC_STARTUP_WHERE` |
| News | Only items whose startup is published and whose market (if any) is public (`lib/news/queries.ts`) |

Outcome and evidence come from `Resolution` and only appear once a market is resolved.

## Measurements

| Label | Source |
| --- | --- |
| YES allocation | `Market.yesCredits / (yesCredits + noCredits)`, null when nothing is allocated. Never called a probability. |
| Calibrated | Latest `MarketSnapshot.calibratedProbability`. Shows "Not yet available" until the engine fills it. |
| Opening baseline | `Market.openingBaseline` with `baselineMethodology` in its tooltip. Shows "Not set" when empty. |
| Outcome | `Resolution.outcome` (`YES`, `NO`, `VOID`), `evidenceSummary`, `evidenceUrls` |

Market pages show `yesCriteria`, `noCriteria`, and `MarketSource` rows (by `position`). Startup profiles show `StartupFact` rows with their source and date. News carries its `verification` label: Verified, Reported (unverified), or Disputed.

## Public read API

Same envelope as `docs/API.md`: `{ data, meta }` and `{ error: { code, message } }`. Lists use cursor pagination (`?cursor=`, `limit` up to 100, default 20). Invalid query values return `VALIDATION_ERROR`.

| Route | Query | `data` |
| --- | --- | --- |
| `GET /api/markets` | `q`, `status`, `industry`, `sort` (`closing`, `active`, `newest`), `cursor`, `limit` | `MarketSummary[]` |
| `GET /api/markets/:slug` | | `MarketDetail` |
| `GET /api/markets/:slug/history` | | `{ marketId, openingBaseline, points: HistoryPoint[] }` |
| `GET /api/startups` | `q`, `industry`, `cursor`, `limit` | `StartupSummary[]` |
| `GET /api/startups/:slug` | | `StartupProfile` |

Types: `lib/market-view/types.ts`.

## Forecast panel contract (Felix)

`components/ForecastPanel.tsx` reads the balance from `GET /api/users/me` (`data.creditBalance`) and posts to `POST /api/forecasts`. The body matches `forecastSubmissionSchema`:

```json
{ "marketId": "...", "side": "YES", "credits": 25, "idempotencyKey": "uuid" }
```

Expected success: `201 { "data": { "id", "marketId", "side", "credits", "createdAt", "entryAllocationShare"?, "balanceAfter"? } }`. The two optional fields are shown on the receipt when present.

Error codes the panel handles: `UNAUTHENTICATED` (sign-in prompt), `INSUFFICIENT_CREDITS`, `INVALID_STATE` (market closed, form locks), `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR` (shows the server message), `FORBIDDEN`. The same idempotency key is resent when a user retries after a network failure, and a new one is made when the forecast changes. The browser never computes balances.

## Shared files touched

- `app/layout.tsx`: adds the Navbar, footer, and Inter and Montserrat fonts.
- `app/globals.css`: imports `components/ui/theme.css` and makes the app light only (`dark:` utilities need an explicit `.dark` class).
- `package.json`: adds `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` (shadcn/ui building blocks) and test-only `jsdom` plus Testing Library.

## Design tokens

`components/ui/theme.css`

| Token | Hex | Use |
| --- | --- | --- |
| `red-500` | `#FF2C2C` | Brand red: YES allocation, chart line, accents, focus ring |
| `red-600` | `#E31B1B` | Red buttons with white text (AA contrast) |
| `red-700` | `#C81E1E` | Red text on white (AA contrast) |
| `ink-900` | `#25282B` | Brand charcoal: text, navbar, footer, primary buttons |
| `white` | `#FFFFFF` | Page background |

Headings use Montserrat (matches the logo), body text uses Inter.

## Tests

`tests/unit/community/` runs with `npm test`. Component tests use a per-file `// @vitest-environment jsdom` comment, so the shared Vitest config is unchanged.
