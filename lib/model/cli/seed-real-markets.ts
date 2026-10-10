// Replaces the local database's demo data with markets on the six real demo
// companies (Stripe, Vercel, Supabase, PostHog, Resend, Convex), built from the
// scraped data in data/model/.
//
//   node --env-file=.env --require ./lib/model/cli/server-only-shim.cjs --import tsx lib/model/cli/seed-real-markets.ts --yes
//
// What it creates:
// - Startups for the six companies, with StartupFact rows from the scraped
//   indicators (value, source link, as-of date). Taglines are hand-written.
// - Open questions of several kinds (lib/model/question-kinds.ts): npm
//   downloads, web traffic rank, hiring and SEC funding filings. Each opens at
//   the model's baseline as of its open date, and only once its data was public.
//   Download markets also record the model's latest value afterwards.
// - One past download question per company, resolved from the real npm counts
//   and settled through the LMSR settlement function.
// - Simulated traders (labelled "Simulated trader") whose trades go through
//   the real forecasting engine, so prices, snapshots and fills are genuine.
//
// It TRUNCATES every table first (local development only; refuses non-local
// databases). Run Ky's `npm run db:seed` to get his demo data back.

import type { Prisma } from "@/generated/prisma/client";
import { ResolutionOutcome, SnapshotTrigger } from "@/generated/prisma/enums";
import { createMarket } from "@/lib/admin";
import { grantSignupCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { ManualClock } from "@/lib/forecasting/adapters/simple";
import { engineFor } from "@/lib/forecasting/server/service";
import { forecastingSettle } from "@/lib/forecasting/server/settle";
import { runSettlement } from "@/lib/settlement";
import { PENDING_AUTH_PREFIX, type SessionUser } from "@/lib/types";
import { createMarketSchema } from "@/lib/validation";
import { computeBaseline } from "../baseline";
import { COMPANIES, metricIds } from "../catalog";
import { addDays } from "../dates";
import { getCompanyIndicators } from "../indicators";
import { seededRandom } from "../math";
import { baselineFor, downloadsQuestion, fundingQuestion, hiringQuestion, niceRound, trafficQuestion, type MarketQuestion } from "../question-kinds";
import { makeQuestion, resolveQuestion } from "../questions";
import { FileModelStore } from "../store";
import type { BaselineResult, DataPoint } from "../types";

const NOW = new Date();
const OPEN_AT = new Date("2026-10-03T00:00:00.000Z");
const PAST_OPEN_AT = new Date("2026-09-06T00:00:00.000Z");
const PAST_WINDOW_END = "2026-10-04";
const PAST_MULTIPLE = 1.1;
/** Open download questions: window end and threshold as a multiple of the last observed week. */
const DOWNLOAD_QUESTIONS = [
  { windowEnd: "2026-10-25", multiple: 1.0 },
  { windowEnd: "2026-11-08", multiple: 1.15 },
] as const;
const TRAFFIC_WINDOW_END = "2026-11-08";
/** Rank threshold as a multiple of today's rank (below 1 means a better rank than now). */
const TRAFFIC_MULTIPLE = 0.95;
const HIRING_DAY = "2026-11-08";
const HIRING_MULTIPLE = 1.05;
const FUNDING_BY = "2026-12-31";
const TRADERS = 40;

/** Hand-written descriptions. Everything numeric on the startup page comes from scraped facts. */
const PROFILES: Record<string, { tagline: string; description: string; website: string; stage: "SERIES_A" | "SERIES_B" | "GROWTH" }> = {
  stripe: { tagline: "Payments infrastructure for the internet", description: "APIs for payments, billing and financial infrastructure used by online businesses.", website: "https://stripe.com", stage: "GROWTH" },
  vercel: { tagline: "Frontend cloud platform", description: "Deployment and hosting platform for web applications; maintains the Next.js framework.", website: "https://vercel.com", stage: "GROWTH" },
  supabase: { tagline: "Open source Postgres development platform", description: "Hosted Postgres with authentication, storage, realtime and edge functions.", website: "https://supabase.com", stage: "GROWTH" },
  posthog: { tagline: "Open source product analytics", description: "Product analytics, session replay, feature flags and experiments for software teams.", website: "https://posthog.com", stage: "GROWTH" },
  resend: { tagline: "Email API for developers", description: "API and SDKs for sending transactional and marketing email.", website: "https://resend.com", stage: "SERIES_A" },
  convex: { tagline: "Reactive backend platform", description: "Backend platform with a reactive database and server functions written in TypeScript.", website: "https://convex.dev", stage: "SERIES_B" },
};

const SOURCE_NAMES: Record<string, string> = {
  npm: "npm downloads API",
  pypistats: "pypistats.org",
  github: "GitHub API",
  sec_edgar: "SEC EDGAR",
  greenhouse: "Greenhouse job board",
  ashby: "Ashby job board",
  workable: "Workable job board",
  tranco: "Tranco ranking",
  hn_algolia: "Hacker News (Algolia)",
};

const MODEL_SOURCE: Record<string, "NPM" | "TRANCO" | "SEC_EDGAR" | "GREENHOUSE" | "ASHBY" | "WORKABLE"> = {
  npm: "NPM",
  tranco: "TRANCO",
  sec_edgar: "SEC_EDGAR",
  greenhouse: "GREENHOUSE",
  ashby: "ASHBY",
  workable: "WORKABLE",
};

const SOURCE_PHRASE: Record<MarketQuestion["kind"], string> = {
  downloads: "Log-trend model on npm weekly downloads. Downloads count installs, not customers or revenue.",
  traffic_rank: "Log-trend model on daily Tranco ranks (about 6 weeks of history). Tranco is a traffic proxy, not a user count.",
  hiring: "Starts from the current count of open postings on the public job board.",
  funding_filing: "Rate of new SEC Form D filings over the last 3 years.",
};

const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (p: number | null) => (p === null ? "?" : `${Math.round(p * 100)}%`);

function methodology(q: MarketQuestion, b: BaselineResult): string {
  return (
    `${SOURCE_PHRASE[q.kind]} Data through ${b.method.details.dataThrough ?? "n/a"}. ` +
    `Model uncertainty band ${pct(b.low)}-${pct(b.high)}, confidence ${b.confidence ?? "n/a"}. Trades never feed the model.`
  ).slice(0, 1000);
}

async function resetDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Refusing to reset a non-local database");
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"public"."${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

async function makeUser(tag: string, displayName: string, admin = false): Promise<SessionUser> {
  const user = await db.user.create({
    data: { authId: `${PENDING_AUTH_PREFIX}${tag}`, email: `${tag}@simulated.senzi.invalid`, displayName, platformRole: admin ? "ADMIN" : "USER" },
    select: { id: true, authId: true, email: true, username: true, displayName: true, avatarUrl: true, platformRole: true },
  });
  if (!admin) await db.$transaction((tx) => grantSignupCredits(tx, user.id));
  return user;
}

async function writeBaselineSnapshot(marketId: string, b: BaselineResult) {
  await db.modelBaselineSnapshot.upsert({
    where: { marketId_inputsHash: { marketId, inputsHash: b.method.details.inputsHash } },
    update: {},
    create: {
      marketId,
      status: b.status === "ok" ? "OK" : b.status === "observed" ? "OBSERVED" : "INSUFFICIENT_DATA",
      probability: b.probability,
      low: b.low,
      high: b.high,
      confidence: b.confidence,
      asOf: new Date(b.asOf),
      dataThrough: b.method.details.dataThrough ? new Date(`${b.method.details.dataThrough}T00:00:00Z`) : null,
      modelName: b.method.name,
      modelVersion: b.method.version,
      inputsHash: b.method.details.inputsHash,
      method: b.method as unknown as Prisma.InputJsonValue,
      inputsUsed: b.inputsUsed as unknown as Prisma.InputJsonValue,
      sources: b.sources as unknown as Prisma.InputJsonValue,
      missing: b.missing,
      notes: b.notes,
    },
  });
}

/** Creates the market as a draft through Ky's createMarket, then opens it at `opensAt` at the model baseline. */
async function createQuestionMarket(admin: SessionUser, startupId: string, q: MarketQuestion, points: DataPoint[], opensAt: Date) {
  const baseline = baselineFor(q, points, opensAt);
  if (baseline.status !== "ok" || baseline.probability === null) {
    console.warn(`  skip ${q.id}: ${baseline.missing.join(" ") || baseline.status}`);
    return null;
  }
  const opening = Math.min(0.99, Math.max(0.01, baseline.probability));
  const input = createMarketSchema.parse({
    slug: `${q.id}-${q.threshold}`.slice(0, 80),
    startupId,
    question: q.text,
    yesCriteria: q.yesCriteria,
    noCriteria: q.noCriteria,
    category: q.category,
    openingBaseline: opening,
    baselineMethodology: methodology(q, baseline),
    visibility: "PUBLIC",
    opensAt,
    closesAt: new Date(q.closesAt),
    resolvesBy: new Date(`${addDays(q.windowEnd, 3)}T00:00:00.000Z`),
    sources: [
      {
        title: q.resolutionTitle,
        url: q.resolutionUrl,
        sourceType: q.kind === "funding_filing" ? "REGULATORY_FILING" : "DATA_PROVIDER",
        license: "LINK_ONLY",
      },
    ],
    openImmediately: false,
  });
  const market = await createMarket(admin, input);

  await db.modelQuestionSpec.create({
    data: {
      marketId: market.id,
      metricId: q.metricId,
      threshold: q.threshold,
      windowEnd: new Date(`${q.windowEnd}T00:00:00Z`),
      windowDays: q.windowDays,
      resolutionSource: MODEL_SOURCE[q.source] ?? "NPM",
      resolutionSourceUrl: q.resolutionUrl,
    },
  });
  await writeBaselineSnapshot(market.id, baseline);

  const opened = await db.market.update({
    where: { id: market.id },
    data: {
      status: "OPEN",
      baselineSetAt: opensAt,
      modelValue: opening,
      modelVersion: `${baseline.method.name}@${baseline.method.version}`,
      modelInputsNote: `${q.category} data through ${baseline.method.details.dataThrough ?? "n/a"}`,
      modelUpdatedAt: opensAt,
    },
  });
  await db.marketSnapshot.create({
    data: {
      marketId: opened.id,
      sequence: 1,
      trigger: SnapshotTrigger.OPENING,
      openingBaseline: opened.openingBaseline,
      modelValue: opened.modelValue,
      yesCredits: 0,
      noCredits: 0,
      allocationShare: null,
      forecastCount: 0,
      forecasterCount: 0,
      recordedAt: opensAt,
    },
  });
  return { market: opened, baseline };
}

/** Simulated trades through the real engine, spread between `from` and `to`. */
async function simulateTrades(marketId: string, baseline: number, traders: SessionUser[], from: Date, to: Date, count: number, rand: () => number) {
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
  // The crowd leans away from the model by a market-specific amount, so the lines can differ.
  const crowdCenter = Math.min(0.95, Math.max(0.05, baseline + 0.1 * gauss()));
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const at = new Date(from.getTime() + ((i + 0.5 + 0.4 * (rand() - 0.5)) / count) * (to.getTime() - from.getTime()));
    const trader = traders[Math.floor(rand() * traders.length)]!;
    const belief = Math.min(0.98, Math.max(0.02, crowdCenter + 0.12 * gauss()));
    const credits = 20 + Math.floor(rand() * 130);
    try {
      await db.$transaction(async (tx) => {
        const engine = engineFor(tx, new ManualClock(at));
        const quote = await engine.quoteForecast({ marketId, side: "YES", amount: credits });
        const side = belief > (quote.fill.priceBefore ?? baseline) ? "YES" : "NO";
        await engine.submitForecast({ kind: "user", userId: trader.id }, { marketId, side, amount: credits, idempotencyKey: `sim-${marketId}-${i}` });
      });
      placed++;
    } catch (err) {
      if ((err as { code?: string }).code !== "INSUFFICIENT_BALANCE") throw err;
    }
  }
  return placed;
}

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("This truncates every table in the local database. Re-run with --yes.");
    process.exit(1);
  }
  const store = new FileModelStore();
  const rand = seededRandom(20261010);

  console.log("Resetting local database...");
  await resetDatabase();

  const admin = await makeUser("real-data-admin", "Senzi data desk", true);
  const traders: SessionUser[] = [];
  for (let i = 1; i <= TRADERS; i++) {
    const n = String(i).padStart(2, "0");
    traders.push(await makeUser(`sim-trader-${n}`, `Simulated trader ${n}`));
  }

  const summary: string[] = [];
  for (const company of COMPANIES) {
    const profile = PROFILES[company.id];
    if (!profile) continue;
    const points = store.readPoints(company.id);
    const startup = await db.startup.create({
      data: {
        slug: company.id,
        name: company.name,
        tagline: profile.tagline,
        description: profile.description,
        websiteUrl: profile.website,
        industry: "Developer tools",
        stage: profile.stage,
        isPublished: true,
        createdById: admin.id,
      },
    });

    // Facts: scraped indicators only, each with its source link and as-of date.
    const facts = getCompanyIndicators(company.id, points, [], NOW).filter((r) => r.provenance === "scraped" && r.value !== null && r.sourceUrl && r.asOf);
    for (const r of facts) {
      const change = r.change4w === null ? "" : ` (${r.change4w >= 0 ? "+" : ""}${Math.round(r.change4w * 100)}% vs 4 weeks earlier)`;
      await db.startupFact.create({
        data: {
          startupId: startup.id,
          label: r.label,
          value: `${fmt(r.value!)} ${r.unit}${change}`,
          sourceName: SOURCE_NAMES[r.source] ?? r.source,
          sourceUrl: r.sourceUrl!,
          sourceType: r.source === "sec_edgar" ? "REGULATORY_FILING" : "DATA_PROVIDER",
          license: "LINK_ONLY",
          asOf: new Date(`${r.asOf}T00:00:00Z`),
        },
      });
    }

    // Thresholds come from the latest real values.
    const probe = computeBaseline(
      makeQuestion({ id: `probe-${company.id}`, companyId: company.id, metricId: company.questionMetricId, threshold: 1, windowEnd: DOWNLOAD_QUESTIONS[0].windowEnd, opensAt: NOW.toISOString() }),
      points,
      NOW,
    );
    const lastWeek = probe.method.details.lastObservedWeek?.total;
    const latestOf = (metricId: string) =>
      points
        .filter((p) => p.metricId === metricId && Date.parse(p.availableAt) <= NOW.getTime())
        .sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
        .at(-1);

    // Each market opens only once its data was public.
    const planned: Array<{ q: MarketQuestion; opensAt: Date; refreshModel: boolean }> = [];
    if (lastWeek) {
      for (const spec of DOWNLOAD_QUESTIONS) {
        planned.push({ q: downloadsQuestion(company.id, niceRound(lastWeek * spec.multiple), spec.windowEnd, OPEN_AT.toISOString()), opensAt: OPEN_AT, refreshModel: true });
      }
    }
    const rank = latestOf(metricIds.trancoRank);
    if (rank) {
      planned.push({ q: trafficQuestion(company.id, niceRound(rank.value * TRAFFIC_MULTIPLE), TRAFFIC_WINDOW_END, OPEN_AT.toISOString()), opensAt: OPEN_AT, refreshModel: false });
    }
    const jobs = latestOf(metricIds.openJobs);
    if (jobs) {
      const at = new Date(jobs.availableAt);
      const q = hiringQuestion(company.id, niceRound(jobs.value * HIRING_MULTIPLE), HIRING_DAY, at.toISOString());
      if (q) planned.push({ q, opensAt: at, refreshModel: false });
    }
    const funding = fundingQuestion(company.id, FUNDING_BY, OPEN_AT.toISOString());
    if (funding) planned.push({ q: funding, opensAt: OPEN_AT, refreshModel: false });

    for (const { q, opensAt, refreshModel } of planned) {
      const made = await createQuestionMarket(admin, startup.id, q, points, opensAt);
      if (!made) continue;
      const from = new Date(opensAt.getTime() + 15 * 60_000);
      const until = new Date(Math.min(NOW.getTime() - 5 * 60_000, made.market.closesAt.getTime() - 3_600_000));
      const span = until.getTime() - from.getTime();
      const count = span < 30 * 60_000 ? 0 : span < 24 * 3_600_000 ? 4 : 9 + Math.floor(rand() * 6);
      const placed = count ? await simulateTrades(made.market.id, made.baseline.probability!, traders, from, until, count, rand) : 0;

      // Download markets: the model refreshes on newer data (trades never feed it).
      if (refreshModel) {
        const latest = baselineFor(q, points, NOW);
        if (latest.status === "ok" && latest.probability !== null && latest.method.details.inputsHash !== made.baseline.method.details.inputsHash) {
          await writeBaselineSnapshot(made.market.id, latest);
          await db.$transaction((tx) =>
            engineFor(tx, new ManualClock(NOW)).recordModelValue({ kind: "service", serviceId: "model-service" }, made.market.id, {
              value: latest.probability!,
              asOf: NOW,
              modelVersion: `${latest.method.name}@${latest.method.version}`,
              inputsNote: `${q.category} data through ${latest.method.details.dataThrough}`,
            }),
          );
        }
      }
      summary.push(`${company.name} [${q.kind}] ${q.text} -> opened at ${pct(made.baseline.probability)}, ${placed} trades`);
    }

    // Past download question, resolved from real data.
    const pastProbe = computeBaseline(
      makeQuestion({ id: `probe-past-${company.id}`, companyId: company.id, metricId: company.questionMetricId, threshold: 1, windowEnd: PAST_WINDOW_END, opensAt: PAST_OPEN_AT.toISOString() }),
      points,
      PAST_OPEN_AT,
    );
    const pastWeek = pastProbe.method.details.lastObservedWeek?.total;
    if (!pastWeek) continue;
    const pastQ = downloadsQuestion(company.id, niceRound(pastWeek * PAST_MULTIPLE), PAST_WINDOW_END, PAST_OPEN_AT.toISOString());
    const pq = makeQuestion({ id: pastQ.id, companyId: company.id, metricId: pastQ.metricId, threshold: pastQ.threshold, windowEnd: PAST_WINDOW_END, opensAt: pastQ.opensAt });
    const resolution = resolveQuestion(pq, points, NOW);
    if (resolution.status !== "resolved" || !resolution.outcome) {
      summary.push(`${company.name}: past question pending (${resolution.reason}), skipped`);
      continue;
    }
    const past = await createQuestionMarket(admin, startup.id, pastQ, points, PAST_OPEN_AT);
    if (!past) continue;
    const placed = await simulateTrades(past.market.id, past.baseline.probability!, traders, new Date(PAST_OPEN_AT.getTime() + 3_600_000), new Date(past.market.closesAt.getTime() - 3_600_000), 8 + Math.floor(rand() * 5), rand);
    await db.market.update({ where: { id: past.market.id }, data: { status: "CLOSED" } });
    const r = await db.resolution.create({
      data: {
        marketId: past.market.id,
        outcome: resolution.outcome === "YES" ? ResolutionOutcome.YES : ResolutionOutcome.NO,
        evidenceSummary: `The npm downloads API reports ${fmt(resolution.observedTotal!)} downloads for the 7 days ending ${pq.windowEnd} (UTC), against a threshold of ${fmt(pq.threshold)}.`,
        evidenceUrls: [pq.resolutionSource.url],
        resolvedById: admin.id,
        resolvedAt: NOW,
        approvedById: admin.id,
        approvedAt: NOW,
      },
    });
    const settled = await runSettlement(r.id, forecastingSettle);
    await db.market.update({ where: { id: past.market.id }, data: { status: "RESOLVED" } });
    summary.push(`${company.name} [past] ${pastQ.text} -> resolved ${resolution.outcome} (${fmt(resolution.observedTotal!)}), ${placed} trades, settlement ${settled.status}`);
  }

  const [startups, markets, forecasts, facts] = await Promise.all([db.startup.count(), db.market.count(), db.forecast.count(), db.startupFact.count()]);
  console.log(summary.join("\n"));
  console.log(`\nDone: ${startups} startups, ${facts} facts, ${markets} markets, ${forecasts} simulated forecasts.`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
