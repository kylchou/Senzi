# Model data sources

What the collectors in `scripts/scrapers/` use, under which terms, and what each source can't give us. Policies were checked on 2026-10-09 against each provider's published documentation. Where a policy wasn't published, the entry says so.

| Source | Used for | Access | Limits we follow | History available | Status |
| --- | --- | --- | --- | --- | --- |
| npm downloads API (`api.npmjs.org`) | Question metric (npm packages), backtest | Public, no auth | Max 18 months per range request, so the collector chains requests. No published rate limit; we space requests 300 ms apart. | Daily, back to 2015 | ✅ Used |
| pypistats.org API | Question metric (PyPI packages) | Public, no auth | IP rate limited. Data updates once a day, so query each endpoint at most once a day. Heavy use should go to Google BigQuery. We space requests 2 s apart and run once a day. | **Last 180 days only** | ✅ Used. Longer history would need BigQuery and a Google Cloud account. |
| SEC EDGAR (`data.sec.gov`, `www.sec.gov`) | Form D raises (dashboard only) | Public, no auth | Max 10 requests/second. A User-Agent with name and contact email is required, read from `SEC_USER_AGENT`; the collector refuses to run without it. We space requests 150 ms apart. | Full filing history | ✅ Used. **Not yet run:** waiting for the team's contact for `SEC_USER_AGENT`. |
| GitHub REST API | Stars, weekly commits (dashboard only) | Public; token optional (`GITHUB_TOKEN`) | 60 requests/hour unauthenticated, 5,000 with a token. | Stars: current value only. Star history is cut off at 40,000 stars, so unusable for large repos. Commits: last 52 weeks. | ✅ Used |
| Greenhouse Job Board API | Open jobs (Vercel, Stripe, Databricks) | Public GET endpoints meant for building job boards | No published limit; 500 ms spacing. | Current snapshot only. History builds up one point per collection day. | ✅ Used |
| Ashby posting API | Open jobs (Supabase, PostHog) | Public job-board endpoint | No published limit; 500 ms spacing. Unlisted postings are excluded. | Current snapshot only | ✅ Used |
| Workable widget API | Open jobs (Hugging Face) | Public endpoint behind Workable's embeddable widget; not formally documented as an API | 1 s spacing | Current snapshot only | ⚠️ Used. Undocumented, so it may change without notice. |
| Tranco list API | Traffic-rank proxy (dashboard only) | Public | 1 query/second (429 when exceeded). We space requests 1.1 s apart. | About 30–40 days via the API. Full historical lists are downloadable but are 1M rows each. | ✅ Used, dashboard only. Too little history for questions. |
| Hacker News Search (Algolia) | Weekly story mentions (dashboard only) | Public | The API page publishes no limit. We space requests 400 ms apart; about 26 requests per company per run. | Full history | ✅ Used. Keyword matching is crude (e.g. "stripe"). |
| Apple App Store lookup | — | — | — | — | ❌ Dropped (team decision): its terms aim the API at promoting apps. |
| LinkedIn, SimilarWeb | — | — | — | — | ❌ Not usable: their terms forbid scraping, or the data is paid. |

## Known data-quality issues

- **npm outage days.** npm reports `0` for days its counting pipeline missed. Every package shows zeros on the same dates: 2023-11-03, 2026-06-03 or 06-05, 07-12, 08-14, 09-03, 09-07, 09-08, 09-15 and 10-06. A zero that is implausible for its series is treated as missing, and any week containing one is left out rather than filled in. In recent months this removes several weeks from each fit.
- **Downloads aren't users.** Counts include CI, mirrors, bots and dependency installs. Several npm packages grew 3–5× in 2026 at the same time, which looks like ecosystem-wide automated traffic. Treat download questions as questions about the public metric, not about customers.
- **Sponsor metrics are simulated in the demo.** ARR, MRR and user counts in `data/model/sponsor/` are placeholders, labeled `simulated: true` and "SIMULATED" wherever they're shown. No demo question depends on them.

## Secrets

`SEC_USER_AGENT` and `GITHUB_TOKEN` are read from `.env`, which is gitignored; `.env.example` has placeholders. Collectors save response bodies only, never request headers. From Form D filings we keep only amounts and dates, not the people listed in them.
