# What the model needs from Ky

The model (`lib/model/`, `scripts/scrapers/`, `data/model/`) doesn't touch shared config, the schema or the lockfile. These are the things that need Ky's call or sign-off.

## 1. Environment variables (environment setup)

Add these to `.env.example`. Nothing breaks without them: the SEC collector stops with a clear error, and GitHub falls back to the 60 requests/hour unauthenticated limit.

```sh
# Required by SEC EDGAR's fair-access policy for the Form D collector.
# Format: "<name or org> <contact email>". Real value goes in .env only.
SEC_USER_AGENT="Senzi research contact@example.com"

# GitHub personal access token, no scopes needed for public repos.
# Raises the API limit from 60 to 5,000 requests/hour.
GITHUB_TOKEN=
```

- **Public repo.** This repo goes public on Devpost. Both values live only in `.env` (already gitignored via `.env*`). The collectors never write the contact or the token to disk, logs or saved responses.
- **Who needs them.** Anyone running the collectors locally. If collection later runs on a schedule (for example a Vercel cron), they'd also need to be set in Vercel. That isn't decided yet.
- **Which email.** SEC asks for a real contact, so the team should pick one address for `SEC_USER_AGENT`. Felix hasn't chosen one.

## 2. Package scripts (`package.json`)

Not edited. The scripts run today with `npx tsx ...` (tsx is already a devDependency). If you want npm aliases, these are the lines:

```json
"scrape": "tsx scripts/scrapers/run.ts",
"model:demo-data": "tsx lib/model/cli/make-demo-data.ts",
"model:refresh": "tsx lib/model/cli/refresh.ts",
"model:backtest": "tsx lib/model/cli/backtest.ts"
```

No new dependencies were added. The scrapers use `fetch` (Node 22) and `dotenv` (already a devDependency).

## 3. Tests and CI

Model tests are in `lib/model/*.test.ts` and `tests/unit/scrapers/`, so the `unit` project in `vitest.config.mts` already picks them up. They make no network calls (the collector tests use a fake `fetch`), so CI needs nothing extra.

## 4. Schema

Proposal in `docs/model-schema-proposal.md`: four tables (`ModelDataPoint`, `ModelQuestionSpec`, `ModelBaselineSnapshot`, `ModelRun`) and three enums. Until they exist the model reads and writes files under `data/model/`. `toMarketModelFields()` in `lib/model/index.ts` already produces the `Market` columns you added (`openingBaseline`, `baselineMethodology`, `baselineSetAt`, `modelValue`, `modelVersion`, `modelInputsNote`, `modelUpdatedAt`).

## 5. Committed data

`data/model/` is about 3.5 MB of collected points, demo questions, simulated sponsor numbers and backtest output. It's committed so the demo and the backtest are reproducible without re-scraping (PyPI only keeps 180 days). If you'd rather keep it out of git, `data/model/points/` is the large part and can be regenerated except for PyPI history older than 180 days.

## 6. Heads-up

Known data problems that affect the demo baselines are in `docs/model.md` under "Known issues".
