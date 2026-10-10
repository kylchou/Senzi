# UI pages by user type

Oct 10, 2026. Built from the route list in `app/`. The "Built" status means a page file exists at that route. It has not been checked for completeness. The account-type split itself is proposed in `docs/account-types-proposal-for-ky.md` and not yet applied.

## Shared (everyone)

| Page | Route | Owner | Status |
| --- | --- | --- | --- |
| Homepage and tutorial | `/` | Sahil | Built |
| Market list | `/markets` | Sahil | Built |
| Market detail (three charts, trade panel) | `/markets/[slug]` | Sahil | Built |
| Startup directory | `/startups` | Sahil | Built |
| Startup page | `/startups/[slug]` | Sahil | Built |
| News | `/news` | Sahil | Built |
| Search | `/search` | Sahil | Built |
| Sign in | `/sign-in` | Ky | Built (Clerk) |
| Sign up with account-type picker | `/sign-up` | Ky | **To build.** Clerk form exists, picker does not |
| Choose account type (fallback) | `/onboarding` | Ky | **To build** |

## VC (sponsor)

| Page | Route | Owner | Status |
| --- | --- | --- | --- |
| VC dashboard | `/vc` | Darsh | Built |
| Research studies: list, new, detail, edit, report | `/vc/studies/**` | Darsh | Built |
| Watchlists | `/vc/watchlists` | Darsh | Built |
| Alerts | `/vc/alerts` | Darsh | Built |
| Reports | `/vc/reports`, `/vc/reports/[reportId]` | Darsh | Built |
| Compare companies | `/vc/compare` | Darsh | Built |
| Study review queue (platform admins) | `/vc/review` | Darsh | Built |
| **Pose a new question** (metric, threshold, window, resolution source, prize pool, quorum) | e.g. `/vc/questions/new` | Darsh (form), Felix (opening price) | **To build.** Markets are only created in `/admin/markets/new` today |
| **My questions** (status, quorum progress, results visible only to the sponsor) | e.g. `/vc/questions` | Darsh | **To build** |
| **Enter startup metrics** (ARR, MRR, users, labeled sponsor-provided, with as-of dates) | e.g. `/vc/companies/[slug]/metrics` | Darsh (form), Ky (storage) | **To build.** Check whether it can write to the existing `ModelDataPoint` table |
| **Company page**: three charts plus the indicators panel (scraped signals and sponsor metrics, each with source and date) | e.g. `/vc/companies/[slug]` | Darsh, using Felix's history and model services | **To build** (not confirmed whether `/vc/compare` covers part of it) |
| Model methodology and backtest results | e.g. `/vc/model` | Felix | **To build** |

## Trader (retail)

| Page | Route | Owner | Status |
| --- | --- | --- | --- |
| **Portfolio** (balance, active and resolved forecasts, results) | `/portfolio` | Felix | **To build.** API exists at `/api/portfolio` |
| **Forecast receipt** after a trade | component `ForecastReceipt.tsx` | Felix | **To build.** API returns receipts |
| **Leaderboard** | none | Felix | **Removed from the site.** The engine and `/api/leaderboard` remain for later use. |
| **Profile** (stats, achievements, accuracy) | `/profile` | Felix | **To build** |
| **My markets** (markets the trader is verified for and can trade) | `/markets` filter or `/portfolio` tab | Sahil, Felix | **To build** |
| **Verification / unlock markets**: a "Unlock new markets" box listing startups the trader can verify for; a pop-up per startup with a one-time code, a screenshot upload, a signed non-insider statement, and pending/approved status | e.g. `/verify`, plus a modal | Unassigned (verification service) | **To build.** Approval is mocked with an admin button for the demo |
| **Locked state on market pages** ("Verify you use X to trade") | inside `/markets/[slug]` | Sahil | **To build** |

## Admin (platform)

Already built by Ky: `/admin`, `/admin/markets` (list, new, detail, resolution), `/admin/startups`, `/admin/news`, `/admin/resolutions`, `/admin/users`, `/admin/audit`.

Still needed: a **verification review queue** (approve or reject trader screenshots, then delete them), which is the demo's mocked approve button.

## Navigation after the split

- After sign-in, VCs land on `/vc` and traders land on `/portfolio` (on `/markets` until the portfolio page exists).
- The top navbar (Sahil's `Navbar.tsx`) should show "Dashboard" for VCs and "Portfolio" plus "Unlock markets" for traders.

## Decided

- VC accounts cannot trade on any market. Only trader accounts can submit forecasts (decided Oct 10, 2026).
- Until account types land, the navbar "VC dashboard" link shows for every signed-in user (`components/ui/VcLink.tsx`). `/vc` still needs org membership.

## Open questions

- Does "verified user" mean a user of the startup's product? CLAUDE.md lists this as open, and the verification page depends on it.
