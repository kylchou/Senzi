# Senzi

Senzi is a place to forecast what startups will do next. Will a company hit 10,000 users by December? Raise a Series A by spring? Ship its product on time? Each of these is a YES/NO question with a deadline and agreed sources. People back their view with virtual credits, and the market price shows what everyone expects together.

There are two sides. The public side is for anyone who wants to forecast. The private side, Senzi Intelligence, gives VC firms a workspace to run their own research questions, follow startups, and write reports. Both sides share one login, one database, and one forecasting engine.

Credits are virtual. They can't be bought, cashed out, or withdrawn, and forecasts are research signals, not investment advice.

## How it works

### For forecasters

1. **Sign up as a trader.** You get 1,000 virtual credits. If you're new, `/how-it-works` walks you through a practice market with a made-up startup first. Nothing there touches your real account.
2. **Pick a question.** Every market states exactly what counts as YES and NO, the deadline, and the sources that will settle it. Those terms lock when the market opens, so nobody can move the goalposts later.
3. **Read the numbers.** Each market shows three separate figures:
   - the **opening baseline**, where the market started, with the method behind it
   - the **market probability**, where everyone's trading has pushed it since
   - the **model estimate**, Senzi's own estimate from public data like package downloads and hiring
4. **Make a forecast.** Spend credits on YES or NO shares. Prices come from an LMSR market maker, so buying YES pushes the probability up, and the less likely an outcome looks, the cheaper its shares are. Every trade is saved, and Market Replay lets you scrub back through how expectations moved.
5. **Wait for the outcome.** After the deadline, one admin proposes the result with evidence and a second admin has to approve it. Then each winning share pays 1 credit. If a question turns out to be broken, it's voided and everyone gets back what they spent.
6. **Track how you did.** `/profile` shows your balance, lifetime profit or loss, open and settled positions, and every credit movement. You can rearrange it however you like.

**Markets for verified users.** Some markets are only for people who actually use the product, like "verified Stripe users only". You prove it at `/verify/<startup>` with an access code (instant) or a screenshot of your account (an admin checks it). Verified users can trade on those markets, and their forecasts on any of that startup's markets make up the Verified Users line. For a demo, use the code `STRIPE-DEMO` at `/verify/stripe`.

The public pages also include a startup directory, news, and search. They work in eight languages and come with accessibility options like read-aloud, dyslexia-friendly text, high contrast, color-blind-friendly charts, and reduced motion.

### For VC firms

1. **Sign up as a VC and get verified.** You send your firm's name, website, your role, and a work email, and a Senzi admin checks them before VC access turns on. If your firm is already on Senzi, its admin can invite you instead, which verifies you right away. VC accounts can't trade, so nobody can forecast on questions their own firm sponsors.
2. **Work as a firm.** Each firm is an organization with owners, admins, analysts, and viewers. Everything private stays inside the firm. Outsiders, including Senzi's own admins, get a "not found" page.
3. **Run research studies.** A study is a question your firm wants the crowd's view on. It goes from draft to review, and once a Senzi admin approves it, it opens as a market. You choose who can see and forecast on it: everyone, your whole firm, or a short list of people.
4. **Follow along.** Watchlists, alerts when a market moves, side-by-side comparisons, and saved reports. Tyche, the research assistant, answers questions using only data your firm can already see, and cites every claim.

### Behind the scenes

- **Credits live in a ledger.** Every change to a balance writes a ledger row in the same database transaction. Rows can't be edited or deleted, retries can't pay twice, and a scheduled job checks every balance against the ledger.
- **Permissions are checked on the server.** Nothing trusts a user id sent from the browser.
- **Admins leave a trail.** Changes to markets, credits, roles, and verifications go in an audit log with the old and new values.
- **Scheduled jobs** close markets at their deadline, retry settlements that failed, and keep VC studies in sync with their markets.

## Getting started

You need Node 20.9+ and Postgres 17 (Docker is the easiest way to get it).

```bash
npm install
cp .env.example .env          # then add your Clerk keys
docker compose up -d          # Postgres with senzi and senzi_test databases
npm run db:deploy             # apply migrations
npm run db:seed               # demo data: 20 startups, 31 markets, a demo VC firm
npm run dev
```

To get into `/admin`, put your email in `SENZI_ADMIN_EMAILS` before you sign in for the first time. If you also set `SEED_DEMO_EMAIL` before seeding, that account becomes an owner of the demo firm (Northstar Ventures), so you can see the VC side too.

`npm run db:reset` wipes your local database and reseeds it.

## Where things live

| Path | What's there |
|---|---|
| `app/` | Pages and API routes. `app/vc` is the VC side, `app/admin` the admin tools. |
| `components/` | UI. `components/vc` belongs to the VC side, `components/ui` holds the shared pieces. |
| `lib/forecasting/` | LMSR pricing, trades, portfolios, leaderboards, settlement |
| `lib/model/` | The model behind the model estimate. Data collectors are in `scripts/scrapers/`. |
| `lib/vc/` | Studies, watchlists, alerts, reports, and Tyche |
| `lib/*.ts` | Auth, permissions, credits, admin, organizations, verification |
| `prisma/` | Database schema, migrations, and seed data |
| `docs/` | API contracts ([docs/API.md](docs/API.md)) and design notes |

## Team

| | Area | Owns |
|---|---|---|
| Kyler | Backend, database & security | `prisma/`, `lib/{db,auth,permissions,validation,api-response,credits,admin,types,audit,organizations,users,verification}.ts`, `app/api/{users,organizations,admin}/`, `app/admin/`, shared config and CI |
| Felix | Forecasting engine & analytics | Pricing, trades, probability history, portfolios, leaderboards, settlement, the model |
| Darsh | VC intelligence | Private dashboards, studies, watchlists, alerts, reports, Tyche |
| Sahil | Community UI & design | Homepage, startup directory, markets, search, news, forecasting UI, accessibility, public read APIs |

Schema changes go through Kyler. Open an issue or ping him instead of editing `prisma/schema.prisma` yourself.

## Scripts

- `npm run dev` / `build` / `start`
- `npm run lint`, `npm run typecheck`
- `npm test` runs unit tests (no database needed)
- `npm run test:integration` runs against `TEST_DATABASE_URL` and empties it between tests. It refuses to run unless the database name ends in `_test`.
- `npm run test:e2e` runs Playwright. It needs Clerk keys and a running database.
- `npm run db:migrate` creates a new migration (Kyler only)

## Stack

Next.js 16 (App Router), React 19, TypeScript, Postgres with Prisma 7, Clerk for sign-in, Zod, Tailwind, Vitest, and Playwright, deployed on Vercel. Check with the team before adding a library that overlaps with one of these.

## Rules worth knowing

- **Use the auth helpers.** Server code goes through `requireUser()`, `requirePlatformAdmin()`, or `requireAccountType()`.
- **Balances only change through `lib/credits.ts`.** Never update `creditBalance` directly.
- **Keep the three numbers separate.** Baseline, market probability, and model estimate are different things. Don't show one where another is expected.
- **Nothing private goes into public code paths.** That covers firm data, sponsor metrics, and anything behind an org. The repo is public too, so real sponsor data never goes in git.

## Git

Work on a branch off `dev` and open a focused PR into `dev`. Nobody commits to `main` directly. Every PR needs one approval and a green CI run (lint, typecheck, unit and integration tests, migrations, the seed, and a production build).
