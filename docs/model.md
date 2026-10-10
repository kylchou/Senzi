# Model: opening baselines

Code: `lib/model/`. Collectors: `scripts/scrapers/`. Model scripts (refresh, backtest, demo data): `lib/model/cli/`. Data: `data/model/`.

## Active demo selection

The original six are Stripe, Vercel, Supabase, PostHog, Resend, and Convex. Their primary question metrics are the official npm packages `stripe`, `vercel`, `@supabase/supabase-js`, `posthog-js`, `resend`, and `convex`. They keep the hand-picked model questions in `questions.json`.

On 2026-10-10 we added 25 more from the expansion list, picked for having the most public data: an official npm SDK and GitHub repo for all of them, PyPI for 22, and a public job board for 23. They are OpenAI, Anthropic, Sentry, ClickHouse, Linear, Clerk, Pinecone, Temporal, PlanetScale, WorkOS, Inngest, E2B, Exa, LangChain, LlamaIndex, Chroma, Cohere, Hugging Face, ElevenLabs, Plaid, Together AI, Browserbase, OpenRouter, Mistral AI, and fal. Each question metric is the company's main npm SDK (see `lib/model/catalog.ts`). None has a verified SEC CIK yet, so there are no Form D questions for them. The scraped-data seed (`lib/model/cli/seed-real-markets.ts`) builds markets for all 31.

The active dataset was freshly collected and checked against public package, repository, and SEC metadata. See `data/model/validation-report.json` for dates, continuity, provenance, flagged counter zeros, and missing secondary sources; `data/model/identity-report.json` records verified identities. Raw download histories begin January 2023 and are current through the latest complete day, October 8, 2026. Sponsor KPIs remain explicitly simulated and do not affect these questions.

The previous active dataset is preserved in `data/model/archive/pre-six-company-refresh-20261010/`. Candidate evaluation data and its report remain separate historical research in `data/model/candidate-evaluation/`. Backtest generation now scores the actual settings from `params.ts` without silently replacing them with a new all-data fit.

To stage and validate a future refresh before replacing the active dataset:

```sh
node node_modules/tsx/dist/cli.mjs scripts/scrapers/run.ts --data-dir=data/model/refresh-staging
node node_modules/tsx/dist/cli.mjs lib/model/cli/validate-demo-data.ts --data-dir=data/model/refresh-staging --verify-identities
```

Resend's official careers site has no verified supported job-board API. Convex's commit-activity endpoint returned "still computing" in this collection. These values stay missing; both companies have complete primary npm histories. An absent SEC identifier means no verified filer is configured, not proof that no filings exist.

## Calling it

```ts
import { getBaseline, toEngineBaseline, getCompanyIndicators } from './lib/model/index.js';

const b = getBaseline('q-supabase-2026-11-08', { asOf: new Date() });
// b.probability, b.low, b.high      point estimate and model-uncertainty band (null if not enough data)
// b.bandLabel                       always "model uncertainty". Not a confidence interval on the outcome.
// b.status                          'ok' | 'insufficient_data' | 'observed' (window already reported)
// b.confidence                      'low' | 'medium' | 'high'
// b.inputsUsed, b.sources           what fed the number, with provenance (scraped vs sponsor-provided)
// b.method                          name, version, plain-language description, numbers behind the result
// b.missing, b.notes                data the model lacked, and caveats (outages, level shifts, spikes)

engine.recordModelValue(modelServiceAuth, marketId, toEngineBaseline(b)!); // forecasting engine
```

- `computeBaseline(question, points, asOf, { sponsorPoints })` is the pure function underneath, for tests and the backtest.
- `refreshBaseline(questionId)` stores a snapshot only when the inputs changed, so the baseline moves only when new data arrives.
- `getCompanyIndicators(companyId, points, sponsorPoints, asOf)` returns the indicators-panel rows for the VC dashboard. Each row has its value, as-of date, change vs four weeks earlier, source and provenance label. Sponsor rows read "Sponsor-provided (SIMULATED …)" in the demo.

## Rules it follows

- **Trades never feed the model.** Its only inputs are data points.
- **Sponsor data rarely moves the number.** It can change a baseline only when it measures the question's own metric. It then fills weeks missing from scraped data, and scraped data wins wherever both exist. ARR, MRR and user counts are display-only. A test checks this.
- **Missing data stays missing.** Incomplete weeks are left out, never filled in, and listed in `missing`.
- **Results are deterministic.** The band's random seed is derived from the question and its input data.

## Running it

```sh
npx tsx scripts/scrapers/run.ts        # collect data (needs SEC_USER_AGENT in .env for Form D; see .env.example)
npx tsx lib/model/cli/make-demo-data.ts # demo questions + SIMULATED sponsor metrics
npx tsx lib/model/cli/refresh.ts       # compute baselines, store snapshots on change, resolve past questions
npx tsx lib/model/cli/backtest.ts      # regenerate docs/model-backtest.md (about 4 minutes)
```

Tests run with the repo's `npm test` (the model's are in `lib/model/*.test.ts`, the collectors' in `tests/unit/scrapers/`).

See `docs/model-backtest.md` for performance, `docs/model-data-sources.md` for sources and terms, `docs/model-schema-proposal.md` for the tables Engineer 1 would need to add, and `docs/model-for-ky.md` for what the model needs from Ky.

## Known issues (fix later)

Found while checking the first real baselines on 2026-10-10 UTC. None blocks the demo, but each can make a baseline wrong. Numbers below describe the original six-company dataset, now preserved in `data/model/archive/pre-six-company-refresh-20261010/`. Databricks and Hugging Face examples are historical; the active dataset uses Resend and Convex instead.

### 1. npm and PyPI counts shifted for the whole ecosystem at once (most important)

- **npm jump.** npm's counter reported 0 on 7 days since July (and 2023-11-03), so the weeks ending 2026-07-12, 08-16 and 09-06 through 09-20 are missing. Right after that gap every npm package jumped 25–40% together: Supabase 25.0M→35.0M, Stripe 19.5M→27.5M, PostHog 12.7M→18.9M, Vercel CLI 3.8M→5.2M. Four unrelated companies moving in step points to npm-wide automated traffic or a counting change, not real growth.
- **PyPI drop.** Both PyPI series fell about 50% in the same week (ending 2026-08-30): Hugging Face 120.9M→57.5M, Databricks 36.7M→21.6M. This also looks like a counting change.
- **Effect.** The 96–97% calls on Vercel, Stripe and PostHog only hold if the npm jump persists, and they would fail together if it reverses. The past Supabase question (window ending 2026-10-04, baseline 39%) resolved YES at 35.0M because of the same jump. The Databricks baseline (19%) is probably too low: its drop is just under the level-shift cutoff, so it reads as a 3.3%/week decline.
- **To try.**
  1. Lower `levelShiftThreshold` from 0.5 to 0.4. It scored the same on older data (calibration log loss 0.2974 vs 0.2972) and would catch Databricks. It wasn't changed because that would be tuning to the numbers just seen.
  2. Add a cross-series check: when most series jump or drop together in the same week, flag it as a probable counting change and widen the band.
  3. Decide whether to keep npm download questions at all (see `docs/model-backtest.md` limits).
  4. Check whether npm or PyPI publish a note about these changes.

### 2. The model is overconfident at the extremes and its ranges are too narrow

- When it says 90–100%, the event happens 88.6% of the time. When it says 0–10%, it happens 7.4% of the time. So it is off by about 4 points at the low end and 7 at the high end.
- The displayed 80% range for the 7-day total covers only 51–76% of actual totals (1 to 8 weeks ahead) on the test period. 2026 is more volatile than 2023–25. The range is tuned on the last 12 months, which is in-sample.
- **To try.** Re-tune on a rolling window, or widen the spread with the horizon more aggressively. Re-check after a few more weeks of data.

### 3. Outage days are dropped, not repaired

Zero-valued days that are implausible for the series are treated as missing, and any week containing one is left out. Recent weeks are the ones most affected (5 of the last 16 weeks are missing for npm series), which lengthens the effective forecast horizon. **To try:** fill single missing days from the neighbouring same weekday, only for a single day in a week, and flag the week as partly estimated.

### 4. No ground truth beyond downloads

Revenue disclosures are not inputs to these download forecasts. The backtest questions are synthetic, and the model has never been checked against a real sponsor question. See the limits in `docs/model-backtest.md`.

### 5. Smaller items

- Resend hiring is unavailable through the supported collectors; Convex commit history was still computing at refresh time.
- Hacker News keyword matching is crude.
- Tranco history is about 40 days.
- Form D collection succeeded for Supabase, Vercel and Stripe. The other three have no verified filer configured, which does not imply they have no filings.
