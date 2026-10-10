# Community UI (Sahil)

Public Senzi pages: homepage, markets, market detail, startups, startup profiles, search, news (`/news`), and the forecast panel. Market pages also have a generated share image (`app/markets/[slug]/opengraph-image.tsx`). Setup and environment variables are in the README and `.env.example`; the only optional variable is `SENZI_REPLAY_DEMO` (see Market Replay).

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
| `GET /api/markets/:slug/replay` | | `ReplayData` (see Market Replay) |
| `GET /api/startups` | `q`, `industry`, `cursor`, `limit` | `StartupSummary[]` |
| `GET /api/startups/:slug` | | `StartupProfile` |

Types: `lib/market-view/types.ts`.

## Forecast panel contract (Felix)

`components/ForecastPanel.tsx` reads the balance from `GET /api/users/me` (`data.creditBalance`) and posts to `POST /api/forecasts`. The body matches `forecastSubmissionSchema`:

```json
{ "marketId": "...", "side": "YES", "credits": 25, "idempotencyKey": "uuid" }
```

Expected success: `201 { "data": { "id", "marketId", "side", "credits", "createdAt", "entryAllocationShare"?, "balanceAfter"?, "priceAfter"? } }`. Optional fields may be null or absent and are shown on the receipt only when set: `priceAfter` as "General Users estimate after", `balanceAfter` as "Balance after". Other LMSR receipt fields (`shares`, `averagePrice`, `digest`, and so on) are accepted and ignored. When `balanceAfter` is null the panel refetches the balance from `/api/users/me`.

Error codes the panel handles: `UNAUTHENTICATED` (sign-in prompt), `INSUFFICIENT_CREDITS`, `INVALID_STATE` (market closed, form locks), `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR` (shows the server message), `FORBIDDEN`. The same idempotency key is resent when a user retries after a network failure, and a new one is made when the forecast changes. The browser never computes balances.

## Demo crowd and market charts

`npm run db:seed` adds about 2,000 fictional forecasters (`prisma/seed-crowd.ts`). Sizes follow public forecasting data: Metaculus questions average about 82 forecasters (95th percentile about 166) with about 2 predictions each, most Manifold markets have under 50 traders, and participation and stake sizes are heavily skewed. Seeded result: 1,241 active forecasters, public markets with a median of 91 forecasters (65 to 229 for the 5th to 95th percentile), 1.3 forecasts per forecaster, a median stake of 35 credits, and about 6.5% verified product users. Private research markets keep their two analysts.

Each simulated forecast goes through the LMSR rule like a real one (fill, General Users and Verified Users estimates per snapshot) and debits the ledger, so ledgers verify and Replay has real lines on every market. Seeding takes about 10 seconds.

Market charts draw straight segments between snapshots with an axis zoomed to the data (`lib/market-view/chart.ts`). The YES allocation line starts once 15 forecasters have taken part (`settledPoints`), because the first few forecasts swing the share between 0% and 100%; the data table lists every point.

## Market Replay

A Replay button beside the market chart opens a dialog that plays the market's history back. Code: `components/ui/replay/` (UI), `lib/market-view/replay.ts` (pure logic, unit tested), `lib/market-view/replay-data.ts` (server query).

Signals, all read from existing `MarketSnapshot` rows (ordered by `sequence`, forward-filled between rows):

| Label | Column |
| --- | --- |
| Senzi Model | `modelValue` |
| General Users | `generalEstimate` |
| Verified Users | `specializedEstimate` |

`ReplayData` is `{ source, market, start, end, points, events, activity, resolution }`.

- `points`: `{ at, model, general, verified, forecasts, credits }`, values 0 to 1 or null when a signal has not been recorded.
- `events`: `{ id, at, kind, title, detail?, url?, origin }`. `origin` is `real` (market opened, opening baseline, linked news, resolution), `derived` (computed from the history: large moves and wide gaps), or `demo`.
- `activity`: forecasts grouped into about 60 time buckets with YES and NO counts and credits only. No user ids.
- `resolution`: outcome, date, and first evidence URL, only once resolved.

Replay needs at least two recorded moments of one signal; otherwise it shows "Not enough history to replay yet." Biggest move, Biggest divergence, and Compare moments are computed from the numbers only.

Demo data: with `SENZI_REPLAY_DEMO=1`, markets without enough history get generated history from `lib/market-view/replay-demo.ts`. The response has `source: "demo"`, the dialog shows a "Demo data" badge, and every demo event is titled "Demo event: ...". Real history always wins. Leave the variable unset in production.

Keyboard: Space plays or pauses, arrow keys step between recorded moments and events, Home and End jump to the ends of the slider, Escape leaves presentation mode and then closes.

## Theme, motion, and app chrome

- Light, dark, and system themes. `components/ui/theme.css` holds the tokens; the ink and red scales, `surface`, `page`, and `hairline` switch under a `.dark` class on `<html>`. The navbar, hero, tutorial, and tab bar use these switching tokens, so every part of the page follows the theme. `night` and `mist` stay fixed and are only for surfaces that must remain charcoal. `white` is never redefined, so VC and admin `bg-white` and `dark:` styles behave as before.
- `ThemeScript` applies the saved or system theme before first paint. `ThemeToggle` (moon or sun in the navbar) switches between light and dark in one click; the OS setting applies until it is used.
- `AppOverlays` mounts the mobile tab bar, the Command-K palette (also `/`), and toasts once.
- `NotificationsBell` reads `GET /api/users/me/notifications` and uses `PATCH` with `{ ids: "all" }`, and badges the tab icon while anything is unread.
- Tooltips (`InfoTip`, chart and replay markers) are removed from layout while hidden and shift to stay on screen, so they never widen the page on phones.
- Motion uses CSS keyframes and React `ViewTransition`; everything is disabled under `prefers-reduced-motion`.
- Preferences kept in `localStorage`: `senzi-theme`, `senzi-a11y`, `senzi-lang`, `senzi-last-credits`, `senzi-recent-searches`, `senzi-filters:<path>`, and `senzi-tour-market-v1`.

## Accessibility center

The accessibility icon in the navbar opens a floating panel (a bottom sheet on phones). Changes apply instantly and are saved in `localStorage` (`senzi-a11y`). A red dot on the icon shows when anything differs from the defaults.

Each setting is a data attribute on `<html>`, applied before first paint by `ThemeScript`. Global CSS in `components/ui/a11y/a11y.css` reacts to it, so pages need no settings logic.

| Setting | Attribute | Effect |
| --- | --- | --- |
| Dyslexia-Friendly Reading | `data-dyslexia` | Letter, word, and line spacing on reading text; shorter lines; slightly larger text. Charts, logos, `translate="no"` names, and `tabular-nums` figures are excluded. |
| Text Size | `data-text-size` (`sm`, `lg`, `xl`) | Rescales Tailwind's `--text-*` variables; large headings scale half as much. Chart labels keep their size. |
| Comfortable Spacing | `data-spacing` | `--spacing` grows 5% and reading line height increases. |
| High Contrast | `data-contrast` | Darker muted text, stronger hairlines, heavier focus ring, underlined text links, grayscale disabled controls. Light and dark. |
| Reduce Motion | `data-reduce-motion` | Stops animations, hover movement, scroll reveals, and view transitions. The OS setting does the same. `motionReduced()` covers animated numbers and Replay easing. |
| Chart Accessibility | `data-chart` (`cvd`, `contrast`) | See below. |
| Focus Mode | `data-focus` | Hides decoration and `data-focus-hide` details; `<Secondary>` sections collapse behind a "Show" button. |
| Larger Controls | `data-large-controls` | 44px minimum targets for buttons, fields, radios, switches, and nav links. Chart markers (`data-hit-exempt="marker"`) gain padding instead. |

Presets (Standard, Reading Friendly, High Visibility, Reduced Motion) set several options at once; users can adjust afterwards.

Charts: every chart takes its line styles from `components/ui/chart-style.tsx`. In Color-Blind Friendly and High Contrast modes Model is solid with circles, General is dashed with squares, and Verified is dotted with triangles. The market chart uses the same patterns for YES allocation, calibrated probability, and baseline. Legends use `LineSwatch` so they match the lines. Future charts (such as portfolio) should use the same module.

Also included:

- `ReadAloud`: speaker button using the browser's SpeechSynthesis, with pause and stop. It reads the page text as shown, so translated text is read in the chosen language. Hidden when speech is unavailable. On the market question and rules, and on each walkthrough step.
- `Term`: dotted-underline term with a plain-language tooltip from `lib/glossary.ts` (Senzi Model, General Users, Verified Users, Probability, Market resolution, Virtual credits, Forecast). Escape hides it.
- Keyboard: Replay, search, and the market tour trap focus while open (`useFocusTrap`); segmented controls use arrow keys; the market chart shows a focus ring.

## Languages

The translate icon offers English (default), Spanish, Mandarin Chinese, Hindi, Portuguese, French, Japanese, and Korean. The choice is saved in `localStorage` (`senzi-lang`) and sets `<html lang>` before first paint.

- Interface text comes from `lib/i18n/messages.ts`: one row per English string with seven translations, plus pattern rules for labels with numbers ("Closes in 12 days"). It works in every browser.
- Database content (market questions, news, startup details) uses the browser's on-device Translator API where available (current Chrome and Edge). Nothing is sent to a server. Other browsers keep that content in English, and the menu says so.
- `components/ui/i18n/translator.ts` translates text nodes in place and follows React updates with a MutationObserver. It skips nodes React has not hydrated yet, so hydration never sees translated text.
- Mark brand names and anything that must stay as written with `translate="no"`. Add new interface strings to `messages.ts`; the unit tests check every language has every string.

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
