# Senzi

Senzi is a startup forecasting platform. People in the community forecast YES/NO outcomes about startups using virtual credits, and VC firms get a private side with research studies, watchlists, and forecast trends. Both sides share one database, one login, and one forecasting engine.

Credits are virtual. They can't be bought, cashed out, or withdrawn, and forecasts are research signals, not investment advice.

## Team

| | Area | Owns |
|---|---|---|
| Kyler | Backend, database & security | `prisma/`, `lib/{db,auth,permissions,validation,api-response,credits,admin,types,audit,organizations,users}.ts`, `app/api/{users,organizations,admin}/`, `app/admin/`, shared config and CI |
| Felix | Forecasting engine & analytics | Forecast submission, probability history, portfolios, leaderboards, settlement |
| Darsh | VC intelligence | Private dashboards, studies, watchlists, alerts, reports |
| Sahil | Community UI & design | Homepage, startup directory, markets, search, news, forecasting UI, public read APIs |

Schema changes go through Kyler. Open an issue or ping him instead of editing `prisma/schema.prisma` yourself.

## Getting started

You need Node 20.9+ and Postgres 17 (Docker is easiest).

```bash
npm install
cp .env.example .env          # then add your Clerk keys
docker compose up -d          # Postgres with senzi and senzi_test databases
npm run db:deploy             # apply migrations
npm run db:seed               # demo data: 20 startups, 31 markets
npm run dev
```

To get into `/admin`, put your email in `SENZI_ADMIN_EMAILS` before you sign in for the first time. If you also set `SEED_DEMO_EMAIL` before seeding, that account becomes an owner of the demo fund (Northstar Ventures) so you can see the VC side too.

`npm run db:reset` wipes the local database and reseeds it.

## Scripts

- `npm run dev` / `build` / `start`
- `npm run lint`, `npm run typecheck`
- `npm test` runs unit tests (no database needed)
- `npm run test:integration` runs against `TEST_DATABASE_URL`, which it empties between tests. It refuses to run unless the database name ends in `_test`.
- `npm run test:e2e` runs Playwright. It needs Clerk keys and a running database.
- `npm run db:migrate` creates a new migration (Kyler only)

## Stack

Next.js 16 (App Router), React 19, TypeScript, Postgres with Prisma 7, Clerk for auth, Zod, Tailwind, Vitest, and Playwright. Deploys to Vercel. Please check with the team before adding a library that overlaps with one of these.

## How the backend works

- Auth: Clerk handles sign-in. On someone's first request, `lib/auth.ts` creates their Senzi user and gives them a one-time grant of 1,000 credits. Server code only trusts `requireUser()` and `requirePlatformAdmin()`, never a user id sent by the client.
- Organizations: VC firms are organizations with OWNER, ADMIN, ANALYST, and VIEWER roles. Anything private (studies, org watchlists, private markets) is checked on the server in `lib/permissions.ts`. Non-members get a 404, so they can't even tell it exists. Platform admins don't get a pass on org data either.
- Credits: `lib/credits.ts` is the only code that changes balances. Every change writes a ledger row in the same transaction, and each one carries an idempotency key, so retries can't double-pay. The database also refuses negative balances and won't let anyone edit or delete ledger rows.
- Markets: admins create public markets with YES and NO criteria, sources, and optionally an opening baseline with its methodology. VC firms get private markets by having a research study approved, which calls `createMarketForStudy`. Once a market opens, its question, criteria, baseline, and sources are locked. To resolve a market, one admin proposes the outcome with sourced evidence and a different admin approves it. Approval creates the `Resolution` and runs settlement, which can be retried if it fails. Corrections go through the same two steps, and nothing in a market's resolution history is ever edited or deleted.
- Pricing: markets use LMSR (`lib/forecasting/lmsr.ts`). Credits buy YES or NO shares, the market probability is the current LMSR price, and each winning share pays 1 credit.
- Three numbers stay separate everywhere: the opening baseline, the market probability, and the calibrated probability from the model. They're different things, so don't show one where another is expected.

## Pages worth knowing

- `/how-it-works` is a guided tutorial and practice mode on a made-up market. It runs entirely in the browser and never calls the forecasting API.
- `/profile` shows your balance, lifetime profit/loss, positions, and credit history. You can edit your name and bio there and choose which sections show.

API contracts and integration notes for everyone else are in [docs/API.md](docs/API.md).

## Git

Work on a feature branch off `dev` and open a focused PR into `dev`. Nobody commits to `main` directly. CI runs lint, typecheck, unit and integration tests, migrations, the seed, and a production build on every PR.
