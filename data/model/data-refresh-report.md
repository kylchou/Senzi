# Selected demo dataset refresh

Completed October 10, 2026 (America/New_York). Active model files use exactly **Stripe, Vercel, Supabase, PostHog, Resend, and Convex**.

| Company | Primary public metric | Daily observations | Latest complete day |
| --- | --- | --- | --- |
| Stripe | npm `stripe` | 1,377 | 2026-10-08 |
| Vercel | npm `vercel` | 1,377 | 2026-10-08 |
| Supabase | npm `@supabase/supabase-js` | 1,377 | 2026-10-08 |
| PostHog | npm `posthog-js` | 1,377 | 2026-10-08 |
| Resend | npm `resend` | 1,377 | 2026-10-08 |
| Convex | npm `convex` | 1,377 | 2026-10-08 |

All primary histories were freshly retrieved from npm, covering January 1, 2023 through October 8, 2026. October 8 was the latest complete day under the collector's publication-delay rule at refresh time. Including secondary indicators, the active dataset contains **11,071 scraped points**. Live metadata checks verified **20 package, repository, and SEC filer identities**.

The validation in [validation-report.json](validation-report.json) passed checks for company and metric membership, allowed source URLs, duplicate observations, nonnegative integer values, provenance, publication chronology, freshness, and uninterrupted calendar-day coverage of each primary series. Identity evidence is in [identity-report.json](identity-report.json); collection outcomes are in [collection-report.json](collection-report.json).

The six open demo questions and their baselines were regenerated, along with one historical Supabase question. Databricks and Hugging Face were removed from active points, sponsor fixtures, questions, and baselines. Previous active files are preserved in [archive/pre-six-company-refresh-20261010](archive/pre-six-company-refresh-20261010/). Candidate-evaluation files remain historical research and are not loaded as active model data.

## Limits retained explicitly

- Source-reported npm zeros are preserved. The model treats implausible zeros as missing and excludes incomplete weeks instead of inventing downloads. Recent counter shifts can still skew forecasts; downloads measure installs, not customers or revenue.
- Resend has no supported public hiring-board collector. Convex's GitHub commit history was still computing after retries; its current stars were collected. Both gaps remain marked missing.
- SEC Form D collection succeeded for the configured Supabase, Vercel, and Stripe filers. No verified filer is configured for the other three; this is not evidence that they have no filings.
- Hacker News counts are keyword matches and Tranco is a traffic-rank proxy. Neither determines the primary download question.
- Sponsor revenue and user fixtures remain explicitly simulated and do not enter these download forecasts.

## Verification

Model and scraper unit tests: **86 passed**. The refreshed backtest contains 31,410 synthetic threshold cases, including 8,730 cases in the later scoring period. Model Brier score is **0.123**, versus **0.169** for persistence; details and calibration limits are in [the backtest report](../../docs/model-backtest.md). Validation establishes consistency with collected public sources, not independent proof that provider counters or forecast probabilities are correct.
