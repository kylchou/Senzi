# Community UI (Sahil)

Public Senzi pages: homepage, markets, market detail, startups, startup profiles, search, news (`/news`), and the forecast panel. Market pages also have a generated share image (`app/markets/[slug]/opengraph-image.tsx`). Setup and environment variables are in the README and `.env.example`; this UI needs nothing extra.

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

## Theme, motion, and app chrome

- Light, dark, and system themes. `components/ui/theme.css` holds the tokens; the ink and red scales, `surface`, `page`, and `hairline` switch under a `.dark` class on `<html>`. The navbar, hero, tutorial, and tab bar use these switching tokens, so every part of the page follows the theme. `night` and `mist` stay fixed and are only for surfaces that must remain charcoal. `white` is never redefined, so VC and admin `bg-white` and `dark:` styles behave as before.
- `ThemeScript` applies the saved or system theme before first paint. `ThemeToggle` (moon or sun in the navbar) switches between light and dark in one click; the OS setting applies until it is used.
- `AppOverlays` mounts the mobile tab bar, the Command-K palette (also `/`), and toasts once.
- `NotificationsBell` reads `GET /api/users/me/notifications` and uses `PATCH` with `{ ids: "all" }`, and badges the tab icon while anything is unread.
- Motion uses CSS keyframes and React `ViewTransition`; everything is disabled under `prefers-reduced-motion`.
- Preferences kept in `localStorage`: `senzi-theme`, `senzi-last-credits`, `senzi-recent-searches`, `senzi-filters:<path>`, and `senzi-tour-market-v1`.

## Shared files touched

- `app/layout.tsx`: adds the Navbar, footer, Inter and Montserrat fonts, `ThemeScript` in `<head>` (with `suppressHydrationWarning` on `<html>`), and `AppOverlays`.
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

- Unit: `tests/unit/community/` runs with `npm test`. Component tests use a per-file `// @vitest-environment jsdom` comment, so the shared Vitest config is unchanged.
- Browser: `tests/e2e/community.spec.ts` runs with `npm run test:e2e` against a built app and a seeded database (`npm run db:seed`), signed out. Every page also runs an axe scan that fails on serious or critical WCAG 2 A/AA issues. Tests run with reduced motion so scans see settled content.

## Performance notes

Measured with Lighthouse 13 against the seeded database (production build):

| Page | Desktop perf | Mobile perf | Accessibility | Layout shift |
| --- | --- | --- | --- | --- |
| Home, markets, startups, news, market detail | 97 to 99 | 78 to 86 | 100 | 0 to 0.09 |

- Streamed filter forms render with default values while loading, so results do not jump.
- Montserrat loads only weights 600 and 700, and the mono font used by admin is no longer preloaded.
- Mobile load time is mostly fonts plus the Clerk client script. Lighthouse also reports a missing description on market pages because Next streams page metadata for regular browsers; search crawlers receive it in the document head.
