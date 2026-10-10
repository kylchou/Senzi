# Candidate model evaluation

Run on October 9, 2026 (Eastern), using data through October 8. No production catalog, parameters, database, or baselines changed.

## Method

Frozen shipped parameters; synthetic thresholds at 0.8/0.9/1/1.1/1.25/1.5 times the last full week; weekly origins; 1/2/4/8-week horizons; no sponsor data. Historical publication dates assumed, not archived vintages. Existing series were previously used in parameter tuning. Also score settings frozen from pre-2025-10 calibration.

All 14 primary company series share April 8–October 8 history for the recent comparison. Origins start July 1. Only the same origin/horizon combinations available for every primary series enter the matched table. Each fit produces six correlated threshold questions; cases are not independent observations.

Matched comparison: 25 origin/horizon fits (150 threshold cases). Fast backtest probabilities matched the public computeBaseline API exactly on up to three historical 4-week/1.1× cases per series (maximum difference 0). Current scenarios run the public API with its full bootstrap.

Lower Brier is better; a constant 50% forecast scores 0.250. Persistence carries the last complete week forward. The recent table uses the same probability spread for both methods. Longer-history tables use the separately tuned model and persistence settings saved from the pre-October-2025 calibration period; no candidate-specific tuning was done.

## Matched recent comparison

| Company | Package metric | Existing/new | Model Brier | Persistence Brier |
|---|---|---|---:|---:|
| stripe | npm_downloads:stripe | existing | 0.058 | 0.163 |
| convex | npm_downloads:convex | new | 0.060 | 0.144 |
| posthog | npm_downloads:posthog-js | existing | 0.064 | 0.201 |
| resend | npm_downloads:resend | new | 0.069 | 0.170 |
| clerk | npm_downloads:@clerk/nextjs | new | 0.075 | 0.171 |
| supabase | npm_downloads:@supabase/supabase-js | existing | 0.083 | 0.126 |
| vercel | npm_downloads:vercel | existing | 0.102 | 0.165 |
| prefect | pypi_downloads:prefect | new | 0.176 | 0.182 |
| dagster | pypi_downloads:dagster | new | 0.180 | 0.152 |
| pinecone | pypi_downloads:pinecone | new | 0.207 | 0.158 |
| modal | pypi_downloads:modal | new | 0.214 | 0.208 |
| sentry | pypi_downloads:sentry-sdk | new | 0.246 | 0.203 |
| databricks | pypi_downloads:databricks-sdk | existing | 0.250 | 0.134 |
| huggingface | pypi_downloads:huggingface_hub | existing | 0.254 | 0.181 |

## Longer npm check

Histories begin January 2023. Test origins start October 1, 2025. The pre-shift subset requires the target window to end by June 1, 2026, excluding the recent npm counting jumps. The frozen pre-2025 model avoids the shipped settings being tuned on this test period. Company-series correlation still limits generalization.

| Company/package | Fits in test | Model Brier | Persistence Brier | Pre-shift model | Pre-shift persistence | Paired improvement 95% range |
|---|---:|---:|---:|---:|---:|---|
| npm_downloads:stripe | 173 | 0.077 | 0.153 | 0.086 | 0.151 | 0.053 to 0.106 |
| npm_downloads:resend | 173 | 0.080 | 0.189 | 0.080 | 0.202 | 0.075 to 0.142 |
| npm_downloads:vercel | 173 | 0.104 | 0.152 | 0.106 | 0.157 | 0.024 to 0.079 |
| npm_downloads:convex | 173 | 0.107 | 0.189 | 0.124 | 0.188 | 0.057 to 0.113 |
| npm_downloads:@clerk/nextjs | 173 | 0.109 | 0.162 | 0.124 | 0.164 | 0.029 to 0.080 |
| npm_downloads:@supabase/supabase-js | 173 | 0.117 | 0.153 | 0.126 | 0.169 | 0.004 to 0.061 |
| npm_downloads:posthog-js | 173 | 0.131 | 0.203 | 0.157 | 0.206 | 0.039 to 0.100 |
| npm_downloads:@huggingface/inference | 181 | 0.153 | 0.137 | 0.167 | 0.148 | -0.030 to 0.001 |
| npm_downloads:next | 173 | 0.160 | 0.176 | 0.182 | 0.192 | -0.016 to 0.050 |

The improvement intervals use a paired four-origin moving-block bootstrap (2,000 samples). Positive favors the model. These are exploratory intervals, not adjusted for selection across candidates or shared source shocks.

## Current four-week scenarios

Question: will the exact package have at least 110% of its latest complete seven-day total during the seven days ending November 5, 2026 (UTC)? Thresholds are illustrative and were fixed before observing the probabilities. These are unresolved forecasts, not evidence of accuracy. Prices shown are proposed model starting YES values for LMSR; no live market was created.

| Company | Last complete week end | Threshold downloads | Forecast median | YES probability | Model uncertainty band | Complete fit weeks |
|---|---|---:|---:|---:|---|---:|
| databricks | 2026-10-08 | 22,694,977 | 18,648,579 | 22.9% | 8.9–31.5% | 16 |
| huggingface | 2026-10-08 | 65,962,566 | 66,405,156 | 52.2% | 35.3–68.9% | 6 |
| posthog | 2026-10-01 | 20,385,010 | 22,852,682 | 80.8% | 78.8–91.9% | 10 |
| stripe | 2026-10-01 | 29,514,464 | 31,228,421 | 73.5% | 68.0–77.9% | 10 |
| supabase | 2026-10-01 | 36,857,161 | 37,475,482 | 55.6% | 48.4–65.3% | 10 |
| vercel | 2026-10-01 | 6,124,412 | 6,474,950 | 70.5% | 63.9–77.9% | 10 |
| modal | 2026-10-08 | 11,774,730 | 10,266,466 | 33.9% | 19.6–41.7% | 16 |
| sentry | 2026-10-08 | 36,567,981 | 32,482,491 | 33.1% | 17.8–39.0% | 16 |
| pinecone | 2026-10-08 | 1,046,103 | 800,984 | 16.6% | 3.9–24.1% | 16 |
| prefect | 2026-10-08 | 1,965,141 | 1,589,131 | 25.3% | 9.0–35.2% | 16 |
| dagster | 2026-10-08 | 2,171,367 | 1,955,756 | 27.2% | 8.7–37.0% | 16 |
| convex | 2026-10-01 | 2,067,513 | 2,155,186 | 64.5% | 55.0–73.5% | 9 |
| resend | 2026-10-01 | 15,958,658 | 17,528,348 | 79.9% | 75.2–88.3% | 10 |
| clerk | 2026-10-01 | 3,335,168 | 3,631,028 | 75.8% | 72.3–86.9% | 10 |

## Historical failures worth inspecting

| Company | Forecast data through | Target window end | YES forecast | Threshold downloads | Actual downloads | Outcome |
|---|---|---|---:|---:|---:|---|
| databricks | 2026-09-01 | 2026-09-08 | 97.5% | 19,549,912 | 19,052,309 | NO |
| huggingface | 2026-09-08 | 2026-09-15 | 97.5% | 56,262,346 | 52,876,398 | NO |
| sentry | 2026-08-18 | 2026-09-01 | 97.5% | 34,508,190 | 26,785,548 | NO |

## Interpretation and limits

- Strongest new candidates: Resend, Convex and Clerk. Resend stays strong on the longer and pre-shift comparisons. Stripe is strongest among existing npm series; Vercel CLI, Supabase and PostHog also beat persistence in the longer test.
- Python availability did not translate to better model output. Databricks, Hugging Face, Sentry, Pinecone and Dagster lose to persistence. Prefect and Modal are mixed; do not promote them based on accessible data alone.
- The existing-company alternate packages are in results.json. Vercel CLI beats next; Hugging Face npm is substantially better than its PyPI series but still loses to persistence over the longer test. Existing Python alternatives for Supabase, Stripe and PostHog also lose to persistence.
- All npm candidates inherit registry outages and shared level shifts, potentially caused by automated traffic or counting changes. Current npm fits have only 9–10 complete weeks of the nominal 16; the last usable weekly total ends October 1. Predicting the counter well does not establish customer growth.
- Python displayed 80% range coverage is only about 44–63% in the recent own-available tests. Several Python series gave roughly 97.5% YES for historical questions that resolved NO. No-zero daily histories concealed structural breaks.
- Original six-company observations are cached from the existing committed collection; new candidates were freshly collected. Counts may be revised after publication, so this is a retrospective reconstruction, not an archived-vintage backtest.
- Thresholds, overlapping horizons and registry-wide movements are correlated. The recent matched test is small. Existing series helped tune the shipped settings. Selection after inspecting these results requires a future prospective holdout.

## Reproduce

```sh
node node_modules/tsx/dist/cli.mjs lib/model/cli/evaluate-candidates.ts --collect
node node_modules/tsx/dist/cli.mjs lib/model/cli/evaluate-candidates.ts --collect-long
node node_modules/tsx/dist/cli.mjs lib/model/cli/evaluate-candidates.ts
```

Collection uses isolated caches in data/model/candidate-evaluation. Raw API responses, normalized points, cases and results are preserved there. Cached responses prevent repeated collection.
