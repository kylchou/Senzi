// Replaces the local database's demo data with markets on the real demo
// companies in lib/model/catalog.ts (31 of them: the original six plus 25 with
// the most public data), built from the scraped data in data/model/.
//
//   node --env-file=.env --require ./lib/model/cli/server-only-shim.cjs --import tsx lib/model/cli/seed-real-markets.ts --yes
//
// What it creates:
// - Startups for the six companies, with StartupFact rows from the scraped
//   indicators (value, source link, as-of date). Taglines are hand-written.
// - Open questions of several kinds (lib/model/question-kinds.ts): npm
//   downloads, web traffic rank, hiring and SEC funding filings. Each opens at
//   the model's baseline as of its open date, and only once its data was public.
//   Download and traffic markets record each model change at the time its data was published.
// - One past download question per company, resolved from the real npm counts
//   and settled through the LMSR settlement function.
// - Simulated traders (labelled "Simulated trader") whose trades go through
//   the real forecasting engine, so prices, snapshots and fills are genuine.
//   There are enough of them, trading often enough, for the price lines to
//   look like a busy market. Each gets a labelled simulation bankroll.
//   They read the same public data as the model, so the crowd stays near the
//   model line and follows it, with a lag, when new data moves the model.
// - A cohort of simulated traders per company verified as users of its product.
//   Their trades on public markets make up the verified line, and each company
//   also gets verified-users-only questions that only its cohort can trade.
//   Simulated product users hold their own (also simulated) view, so the
//   verified line can drift from the general one.
//
// It TRUNCATES every table first. Local databases only, unless
// `--allow-remote=<host>` names the database host; `--keep-users` keeps real
// accounts. Run Ky's `npm run db:seed` to get his demo data back.

import type { Market, Prisma } from "@/generated/prisma/client";
import {
  AccountType,
  OrgRole,
  ProductVerificationMethod,
  ResolutionOutcome,
  SnapshotTrigger,
  StudyStatus,
  StudyVisibility,
  VerificationStatus,
  WatchlistItemType,
} from "@/generated/prisma/enums";
import { createMarket } from "@/lib/admin";
import { applyCreditTransaction, grantSignupCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import { ManualClock } from "@/lib/forecasting/adapters/simple";
import { engineFor } from "@/lib/forecasting/server/service";
import { forecastingSettle } from "@/lib/forecasting/server/settle";
import { runSettlement } from "@/lib/settlement";
import { PENDING_AUTH_PREFIX, type SessionUser } from "@/lib/types";
import { DEMO_ORG_ID, DEMO_ORG_NAME, DEMO_ORG_SLUG } from "@/lib/vc/constants";
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
const TRADERS = 250;
/** Extra credits per simulated trader so a busy market doesn't run them dry. Labelled in the ledger. */
const SIM_BANKROLL = 4_000;
/** Simulated trades per open market (min + random extra), per past market, and per short-lived market. */
const OPEN_TRADES = { min: 45, extra: 35 } as const;
const PAST_TRADES = { min: 30, extra: 20 } as const;
const SHORT_TRADES = 12;

/**
 * Starter data for the shared demo VC firm (Demo Ventures): every PostHog question, plus every
 * company's verified-users questions. The firm is created here; verified VC accounts join it on
 * their first visit (lib/vc/server/demo-org.ts).
 */
const DEMO_COMPANY = "posthog";
/** Simulated traders verified as users of each company's product (a different slice of the pool per company). */
const VERIFIED_PER_COMPANY = 20;
/** Share of trades on public markets placed by verified users, so every public market has a verified line. */
const VERIFIED_TRADE_SHARE = 0.4;
/** Extra download thresholds, as multiples of the last observed week, for the verified-users questions. */
const VERIFIED_DOWNLOAD_QUESTIONS = [
  { windowEnd: "2026-10-25", multiple: 0.9 },
  { windowEnd: "2026-11-08", multiple: 1.3 },
] as const;

/** Hand-written descriptions. Everything numeric on the startup page comes from scraped facts. */
type Stage = "SEED" | "SERIES_A" | "SERIES_B" | "SERIES_C" | "GROWTH";
type Profile = { tagline: string; description: string; website: string; stage: Stage; industry?: string };
const AI = "AI";
const DATA = "Data infrastructure";
// Stages are hand-entered from public funding announcements; industry defaults to Developer tools.
const PROFILES: Record<string, Profile> = {
  stripe: { tagline: "Payments infrastructure for the internet", description: "APIs for payments, billing and financial infrastructure used by online businesses.", website: "https://stripe.com", stage: "GROWTH", industry: "Fintech" },
  vercel: { tagline: "Frontend cloud platform", description: "Deployment and hosting platform for web applications; maintains the Next.js framework.", website: "https://vercel.com", stage: "GROWTH" },
  supabase: { tagline: "Open source Postgres development platform", description: "Hosted Postgres with authentication, storage, realtime and edge functions.", website: "https://supabase.com", stage: "GROWTH" },
  posthog: { tagline: "Open source product analytics", description: "Product analytics, session replay, feature flags and experiments for software teams.", website: "https://posthog.com", stage: "GROWTH" },
  resend: { tagline: "Email API for developers", description: "API and SDKs for sending transactional and marketing email.", website: "https://resend.com", stage: "SERIES_A" },
  convex: { tagline: "Reactive backend platform", description: "Backend platform with a reactive database and server functions written in TypeScript.", website: "https://convex.dev", stage: "SERIES_B" },
  openai: { tagline: "AI research and deployment", description: "Builds the GPT models, ChatGPT and an API used by developers to add AI to their products.", website: "https://openai.com", stage: "GROWTH", industry: AI },
  anthropic: { tagline: "AI safety and research company", description: "Builds the Claude family of AI models, available through an API and apps.", website: "https://www.anthropic.com", stage: "GROWTH", industry: AI },
  sentry: { tagline: "Application monitoring for developers", description: "Error tracking, performance monitoring and session replay for software teams.", website: "https://sentry.io", stage: "GROWTH" },
  clickhouse: { tagline: "Real-time analytics database", description: "Open source column-oriented database and managed cloud for fast analytical queries.", website: "https://clickhouse.com", stage: "GROWTH", industry: DATA },
  linear: { tagline: "Issue tracking for product teams", description: "Project and issue tracking built for speed, used by software and product teams.", website: "https://linear.app", stage: "SERIES_C" },
  clerk: { tagline: "Authentication and user management", description: "Drop-in sign-in, user management and organizations for web and mobile apps.", website: "https://clerk.com", stage: "SERIES_C" },
  pinecone: { tagline: "Vector database for AI applications", description: "Managed vector database for search and retrieval in AI products.", website: "https://www.pinecone.io", stage: "SERIES_B", industry: DATA },
  temporal: { tagline: "Durable execution platform", description: "Open source workflow engine and cloud service for reliable, long-running application code.", website: "https://temporal.io", stage: "SERIES_C" },
  planetscale: { tagline: "Managed MySQL and Postgres", description: "Database platform built on Vitess, with branching and non-blocking schema changes.", website: "https://planetscale.com", stage: "SERIES_C", industry: DATA },
  workos: { tagline: "Enterprise features for apps", description: "APIs for single sign-on, directory sync, audit logs and user management.", website: "https://workos.com", stage: "SERIES_B" },
  inngest: { tagline: "Durable functions and workflows", description: "Event-driven background jobs and workflows for serverless and server apps.", website: "https://www.inngest.com", stage: "SERIES_A" },
  e2b: { tagline: "Cloud sandboxes for AI agents", description: "Secure sandboxes where AI agents and apps run generated code.", website: "https://e2b.dev", stage: "SERIES_A", industry: AI },
  exa: { tagline: "Search engine for AI", description: "Web search API built for AI applications and agents.", website: "https://exa.ai", stage: "SERIES_B", industry: AI },
  langchain: { tagline: "Framework for building AI agents", description: "Open source frameworks and the LangSmith platform for building and testing LLM applications.", website: "https://www.langchain.com", stage: "SERIES_B", industry: AI },
  llamaindex: { tagline: "Data framework for LLM apps", description: "Open source framework and cloud tools for connecting company data to AI models.", website: "https://www.llamaindex.ai", stage: "SERIES_A", industry: AI },
  chroma: { tagline: "Open source AI database", description: "Embedding and vector database for retrieval in AI applications.", website: "https://www.trychroma.com", stage: "SEED", industry: DATA },
  cohere: { tagline: "Enterprise AI models", description: "Language models for search, retrieval and generation, built for businesses.", website: "https://cohere.com", stage: "GROWTH", industry: AI },
  huggingface: { tagline: "The AI community platform", description: "Hub for open models and datasets, and the maintainer of the Transformers library.", website: "https://huggingface.co", stage: "GROWTH", industry: AI },
  elevenlabs: { tagline: "AI voice and audio", description: "Text-to-speech, voice cloning and dubbing models available through apps and an API.", website: "https://elevenlabs.io", stage: "GROWTH", industry: AI },
  plaid: { tagline: "Connecting apps to bank accounts", description: "APIs that let financial apps link to users' bank accounts and verify data.", website: "https://plaid.com", stage: "GROWTH", industry: "Fintech" },
  together: { tagline: "Cloud for open source AI", description: "Inference, fine-tuning and GPU clusters for open models.", website: "https://www.together.ai", stage: "SERIES_B", industry: AI },
  browserbase: { tagline: "Headless browsers for AI agents", description: "Cloud browser infrastructure and the Stagehand framework for web automation.", website: "https://www.browserbase.com", stage: "SERIES_B", industry: AI },
  openrouter: { tagline: "One API for many AI models", description: "A single API and billing account for models from many providers.", website: "https://openrouter.ai", stage: "SERIES_A", industry: AI },
  mistral: { tagline: "Open and efficient AI models", description: "European AI lab building open-weight and commercial language models.", website: "https://mistral.ai", stage: "GROWTH", industry: AI },
  fal: { tagline: "Generative media platform", description: "Fast inference for image, video and audio generation models.", website: "https://fal.ai", stage: "SERIES_C", industry: AI },
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

/** `--name=value` from the command line, or null. */
function flag(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

/**
 * Local databases only, unless `--allow-remote=<host>` names the exact host in DATABASE_URL.
 * With `--keep-users`, real accounts (anything that isn't a seed or simulated address) survive
 * the wipe and get a fresh signup grant, since their old ledger rows go with everything else.
 */
async function resetDatabase(keepUsers: boolean) {
  const url = new URL(process.env.DATABASE_URL ?? "postgres://invalid");
  const local = ["localhost", "127.0.0.1"].includes(url.hostname);
  if (!local && flag("allow-remote") !== url.hostname) {
    throw new Error(`Refusing to reset ${url.hostname}. To reset this remote database on purpose, pass --allow-remote=${url.hostname}`);
  }
  const keep = ["_prisma_migrations", ...(keepUsers ? ["User"] : [])];
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const reset = tables.map((t) => t.tablename).filter((t) => !keep.includes(t));
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${reset.map((t) => `"public"."${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  if (!keepUsers) return;
  // Seed and simulated accounts are recreated below; real accounts stay, with balances matching the empty ledger.
  const removed = await db.user.deleteMany({
    where: { OR: [{ email: { endsWith: "@demo.senzi.invalid" } }, { email: { endsWith: "@simulated.senzi.invalid" } }] },
  });
  const kept = await db.user.findMany({ select: { id: true, email: true } });
  await db.user.updateMany({ data: { creditBalance: 0 } });
  // Same welcome grant every account gets at signup (lib/auth.ts).
  for (const u of kept) await db.$transaction((tx) => grantSignupCredits(tx, u.id));
  console.log(`Kept ${kept.length} real account(s): ${kept.map((u) => u.email).join(", ") || "none"}. Removed ${removed.count} seed/simulated account(s).`);
}

async function makeUser(tag: string, displayName: string, admin = false): Promise<SessionUser> {
  const user = await db.user.create({
    data: {
      authId: `${PENDING_AUTH_PREFIX}${tag}`,
      email: `${tag}@simulated.senzi.invalid`,
      displayName,
      platformRole: admin ? "ADMIN" : "USER",
      // Simulated traders are verified TRADER accounts; VC accounts can't trade.
      ...(admin ? {} : { accountType: AccountType.TRADER, accountVerifiedAt: new Date() }),
    },
    select: {
      id: true,
      authId: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      platformRole: true,
      accountType: true,
      accountVerifiedAt: true,
    },
  });
  if (!admin) {
    await db.$transaction(async (tx) => {
      await grantSignupCredits(tx, user.id);
      // Enough credits for a busy simulated market; the memo makes it obvious in the ledger.
      await applyCreditTransaction(tx, {
        userId: user.id,
        amount: SIM_BANKROLL,
        type: "ADMIN_GRANT",
        idempotencyKey: `sim-bankroll:${user.id}`,
        memo: "Simulation bankroll for a demo trader",
      });
    });
  }
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

/** A question that belongs in the demo firm's study list. */
interface DemoStudyEntry {
  market: Market;
  q: MarketQuestion;
  startupId: string;
  verifiedOnly: boolean;
  outcome: "YES" | "NO" | null;
}

/**
 * Creates the market as a draft through Ky's createMarket, then opens it at `opensAt` at the model baseline.
 * Pass `verifiedOnly` for a verified-users market: listed publicly, but only verified users of the product can trade.
 */
async function createQuestionMarket(admin: SessionUser, startupId: string, q: MarketQuestion, points: DataPoint[], opensAt: Date, verifiedOnly = false) {
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
    verifiedUsersOnly: verifiedOnly,
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

/** The model's value over a market's life: the opening baseline, then each change as new data was published. */
type ModelStep = { at: Date; result: BaselineResult };

/**
 * Replays the model at every time new data for the question became public, from `opensAt` to `until`,
 * keeping only the times its inputs changed. Trades never feed it.
 */
function modelTimeline(q: MarketQuestion, points: DataPoint[], opening: BaselineResult, opensAt: Date, until: Date): ModelStep[] {
  const steps: ModelStep[] = [{ at: opensAt, result: opening }];
  const times = [...new Set(points.filter((p) => p.metricId === q.metricId).map((p) => Date.parse(p.availableAt)))]
    .filter((t) => t > opensAt.getTime() && t <= until.getTime())
    .sort((a, b) => a - b);
  for (const t of times) {
    const r = baselineFor(q, points, new Date(t));
    if (r.status !== "ok" || r.probability === null || r.method.details.inputsHash === steps.at(-1)!.result.method.details.inputsHash) continue;
    steps.push({ at: new Date(t), result: r });
  }
  return steps;
}

function modelValueAt(timeline: ModelStep[], at: number): number {
  let value = timeline[0]!.result.probability!;
  for (const s of timeline) if (s.at.getTime() <= at) value = s.result.probability!;
  return value;
}

/**
 * Simulated trades through the real engine, spread between `from` and `to`, interleaved in time
 * with the model's updates (which go through recordModelValue, as the real model service would).
 *
 * Simulated traders read the same public data the model does, so their beliefs sit near the model:
 * each trader anchors on the model value they last saw (they notice new data 0-24 hours after it is
 * published), plus a small market-wide lean and personal noise. Bets are sized by conviction: a trader
 * moves the price part of the way to their belief, so the crowd catches up after the model moves.
 *
 * Verified users of the product (`pool.verified`) add their own simulated lean on top: what people who
 * use the product read differently from the public data. `verifiedShare` of trades come from them; on a
 * verified-users-only market pass `general: []` and every trade is theirs.
 */
async function simulateTrades(
  marketId: string,
  timeline: ModelStep[],
  pool: { general: SessionUser[]; verified: SessionUser[]; verifiedShare: number },
  from: Date,
  to: Date,
  count: number,
  rand: () => number,
) {
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
  const clampP = (p: number) => Math.min(0.97, Math.max(0.03, p));
  // A market-specific lean keeps the crowd line near the model, not on top of it.
  const lean = 0.04 * gauss();
  // Product users' extra lean, at least 4 points either way so their line visibly separates.
  const userLean = (rand() < 0.5 ? -1 : 1) * (0.04 + 0.06 * rand());
  type Event = { at: Date; run: () => Promise<boolean> };
  const events: Event[] = timeline.slice(1).map((step) => ({
    at: step.at,
    run: async () => {
      await writeBaselineSnapshot(marketId, step.result);
      await db.$transaction((tx) =>
        engineFor(tx, new ManualClock(step.at)).recordModelValue({ kind: "service", serviceId: "model-service" }, marketId, {
          value: step.result.probability!,
          asOf: step.at,
          modelVersion: `${step.result.method.name}@${step.result.method.version}`,
          inputsNote: `data through ${step.result.method.details.dataThrough}`,
        }),
      );
      return false;
    },
  }));
  for (let i = 0; i < count; i++) {
    const at = new Date(from.getTime() + ((i + 0.5 + 0.4 * (rand() - 0.5)) / count) * (to.getTime() - from.getTime()));
    // The first trade is always a verified user's, so even a short market has a verified line.
    const byVerified = pool.general.length === 0 || (pool.verifiedShare > 0 && i === 0) || rand() < pool.verifiedShare;
    const group = byVerified ? pool.verified : pool.general;
    const trader = group[Math.floor(rand() * group.length)]!;
    const seen = modelValueAt(timeline, at.getTime() - rand() * 24 * 3_600_000);
    const belief = clampP(seen + lean + (byVerified ? userLean : 0) + 0.05 * gauss());
    const conviction = 0.35 + 0.5 * rand();
    events.push({
      at,
      run: async () => {
        try {
          await db.$transaction(async (tx) => {
            const engine = engineFor(tx, new ManualClock(at));
            const { fill } = await engine.quoteForecast({ marketId, side: "YES", amount: 1 });
            const price = fill.priceBefore ?? seen;
            const side = belief > price ? "YES" : "NO";
            // LMSR cost of moving the price exactly to the belief; the trader buys part of the way.
            const toBelief = side === "YES" ? fill.b * Math.log((1 - price) / (1 - belief)) : fill.b * Math.log(price / belief);
            const amount = Math.round(Math.min(300, Math.max(10, conviction * toBelief)));
            await engine.submitForecast({ kind: "user", userId: trader.id }, { marketId, side, amount, idempotencyKey: `sim-${marketId}-${i}` });
          });
          return true;
        } catch (err) {
          if ((err as { code?: string }).code !== "INSUFFICIENT_BALANCE") throw err;
          return false;
        }
      },
    });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  let placed = 0;
  for (const e of events) if (await e.run()) placed++;
  return placed;
}

/** The shared demo firm and its owner. VC accounts can't trade, so the owner never appears as a trader. */
async function createDemoFirm() {
  const owner = await db.user.create({
    data: {
      authId: `${PENDING_AUTH_PREFIX}demo-vc-owner`,
      email: "demo-vc-owner@simulated.senzi.invalid",
      displayName: `${DEMO_ORG_NAME} (simulated)`,
      accountType: AccountType.VC,
      accountVerifiedAt: new Date(),
    },
    select: { id: true },
  });
  await db.organization.create({
    data: {
      id: DEMO_ORG_ID,
      name: DEMO_ORG_NAME,
      slug: DEMO_ORG_SLUG,
      description: "Simulated firm with PostHog starter data. New VC accounts join it automatically.",
      memberships: { create: { userId: owner.id, role: OrgRole.OWNER } },
    },
  });
  return owner.id;
}

/** One study per PostHog question and per verified-users question (every company), plus a PostHog watchlist. */
async function seedDemoStudies(ownerId: string, adminId: string, entries: DemoStudyEntry[]) {
  const DAY = 86_400_000;
  const studyIds: string[] = [];
  for (const { market, q, startupId, verifiedOnly, outcome } of entries) {
    const at = (offsetDays: number, base = market.opensAt) => new Date(base.getTime() + offsetDays * DAY);
    const resolved = outcome !== null;
    type Step = [StudyStatus | null, StudyStatus, string, string, Date];
    const steps: Step[] = [
      [null, StudyStatus.DRAFT, "create", ownerId, at(-3)],
      [StudyStatus.DRAFT, StudyStatus.SUBMITTED, "submit", ownerId, at(-2)],
      [StudyStatus.SUBMITTED, StudyStatus.APPROVED, "approve", adminId, at(-1)],
      [StudyStatus.APPROVED, StudyStatus.OPEN, "open", adminId, market.opensAt],
      ...(resolved
        ? ([
            [StudyStatus.OPEN, StudyStatus.CLOSED, "close", adminId, market.closesAt],
            [StudyStatus.CLOSED, StudyStatus.RESOLVED, "resolve", adminId, NOW],
          ] as Step[])
        : []),
    ];
    const study = await db.researchStudy.create({
      data: {
        organizationId: DEMO_ORG_ID,
        createdById: ownerId,
        startupId,
        marketId: market.id,
        question: market.question,
        yesCriteria: market.yesCriteria,
        noCriteria: market.noCriteria,
        context: "Starter question from the shared demo firm. Prices and trades are simulated; the underlying data is real.",
        baselineValue: market.openingBaseline,
        baselineMethodology: market.baselineMethodology,
        deadline: market.closesAt,
        // A verified-users-only question stays with the firm on the VC side; its market is public but gated.
        visibility: verifiedOnly ? StudyVisibility.ORGANIZATION : StudyVisibility.PUBLIC,
        openToPublic: !verifiedOnly,
        openToVerified: verifiedOnly,
        status: resolved ? StudyStatus.RESOLVED : StudyStatus.OPEN,
        submittedAt: at(-2),
        approvedAt: at(-1),
        openedAt: market.opensAt,
        ...(resolved ? { closedAt: market.closesAt, resolvedAt: NOW, resolvedOutcome: outcome === "YES" ? ResolutionOutcome.YES : ResolutionOutcome.NO } : {}),
        version: steps.length,
        sources: { create: [{ url: q.resolutionUrl, title: q.resolutionTitle }] },
        events: { create: steps.map(([fromStatus, toStatus, action, actor, createdAt]) => ({ actorId: actor, action, fromStatus, toStatus, createdAt })) },
      },
      select: { id: true },
    });
    studyIds.push(study.id);
  }
  const posthog = entries.flatMap((e, i) => (e.q.companyId === DEMO_COMPANY ? [{ startupId: e.startupId, studyId: studyIds[i]! }] : []));
  if (posthog.length === 0) return studyIds.length;

  await db.watchlist.create({
    data: {
      organizationId: DEMO_ORG_ID,
      name: "PostHog",
      createdById: ownerId,
      items: {
        create: [
          { type: WatchlistItemType.STARTUP, startupId: posthog[0]!.startupId, addedById: ownerId },
          ...posthog.map(({ studyId }) => ({ type: WatchlistItemType.STUDY, studyId, addedById: ownerId })),
        ],
      },
    },
  });
  return studyIds.length;
}

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("This truncates every table in the local database. Re-run with --yes.");
    process.exit(1);
  }
  const store = new FileModelStore();
  const rand = seededRandom(20261010);

  const keepUsers = process.argv.includes("--keep-users");
  console.log(`Resetting ${new URL(process.env.DATABASE_URL ?? "postgres://invalid").hostname}${keepUsers ? " (keeping real accounts)" : ""}...`);
  await resetDatabase(keepUsers);

  const admin = await makeUser("real-data-admin", "Senzi data desk", true);
  const traders: SessionUser[] = [];
  for (let i = 1; i <= TRADERS; i++) {
    const n = String(i).padStart(2, "0");
    traders.push(await makeUser(`sim-trader-${n}`, `Simulated trader ${n}`));
  }
  const demoOwnerId = await createDemoFirm();
  const demoEntries: DemoStudyEntry[] = [];

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
        industry: profile.industry ?? "Developer tools",
        stage: profile.stage,
        isPublished: true,
        createdById: admin.id,
      },
    });
    // This company's verified product users: a different slice of the trader pool per company,
    // approved before any market opens so every one of their trades counts toward the verified line.
    const offset = (COMPANIES.indexOf(company) * VERIFIED_PER_COMPANY) % TRADERS;
    const verified = Array.from({ length: VERIFIED_PER_COMPANY }, (_, i) => traders[(offset + i) % TRADERS]!);
    const verifiedIds = new Set(verified.map((t) => t.id));
    const pool = { general: traders.filter((t) => !verifiedIds.has(t.id)), verified, verifiedShare: VERIFIED_TRADE_SHARE };
    const verifiedPool = { general: [], verified, verifiedShare: 1 };
    await db.productUserVerification.createMany({
      data: verified.map((t) => ({
        userId: t.id,
        startupId: startup.id,
        method: ProductVerificationMethod.SCREENSHOT,
        status: VerificationStatus.APPROVED,
        reviewedById: admin.id,
        reviewedAt: new Date(PAST_OPEN_AT.getTime() - 86_400_000),
        note: "Simulated verified user for the demo",
      })),
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
          // Everything we scrape comes straight from a public source, so it is marked verified.
          verified: true,
          verifiedById: admin.id,
          verifiedAt: NOW,
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
    const planned: Array<{ q: MarketQuestion; opensAt: Date; refreshModel: boolean; verifiedOnly?: boolean }> = [];
    if (lastWeek) {
      for (const spec of DOWNLOAD_QUESTIONS) {
        planned.push({ q: downloadsQuestion(company.id, niceRound(lastWeek * spec.multiple), spec.windowEnd, OPEN_AT.toISOString()), opensAt: OPEN_AT, refreshModel: true });
      }
      // Extra questions that only the company's verified product users can trade.
      const taken = new Set(planned.map(({ q }) => `${q.windowEnd}:${q.threshold}`));
      for (const spec of VERIFIED_DOWNLOAD_QUESTIONS) {
        const q = downloadsQuestion(company.id, niceRound(lastWeek * spec.multiple), spec.windowEnd, OPEN_AT.toISOString());
        if (taken.has(`${q.windowEnd}:${q.threshold}`)) continue;
        planned.push({ q, opensAt: OPEN_AT, refreshModel: true, verifiedOnly: true });
      }
    }
    const rank = latestOf(metricIds.trancoRank);
    if (rank) {
      planned.push({ q: trafficQuestion(company.id, niceRound(rank.value * TRAFFIC_MULTIPLE), TRAFFIC_WINDOW_END, OPEN_AT.toISOString()), opensAt: OPEN_AT, refreshModel: true });
    }
    const jobs = latestOf(metricIds.openJobs);
    if (jobs) {
      const at = new Date(jobs.availableAt);
      const q = hiringQuestion(company.id, niceRound(jobs.value * HIRING_MULTIPLE), HIRING_DAY, at.toISOString());
      if (q) planned.push({ q, opensAt: at, refreshModel: false });
    }
    const funding = fundingQuestion(company.id, FUNDING_BY, OPEN_AT.toISOString());
    if (funding) planned.push({ q: funding, opensAt: OPEN_AT, refreshModel: false });

    for (const { q, opensAt, refreshModel, verifiedOnly = false } of planned) {
      const made = await createQuestionMarket(admin, startup.id, q, points, opensAt, verifiedOnly);
      if (!made) continue;
      if (company.id === DEMO_COMPANY || verifiedOnly) demoEntries.push({ market: made.market, q, startupId: startup.id, verifiedOnly, outcome: null });
      const from = new Date(opensAt.getTime() + 15 * 60_000);
      const until = new Date(Math.min(NOW.getTime() - 5 * 60_000, made.market.closesAt.getTime() - 3_600_000));
      const span = until.getTime() - from.getTime();
      const count = span < 30 * 60_000 ? 0 : span < 24 * 3_600_000 ? SHORT_TRADES : OPEN_TRADES.min + Math.floor(rand() * OPEN_TRADES.extra);
      // Download and traffic-rank markets: the model refreshes as new data is published (trades never feed it).
      const timeline = refreshModel ? modelTimeline(q, points, made.baseline, opensAt, NOW) : [{ at: opensAt, result: made.baseline }];
      const placed = await simulateTrades(made.market.id, timeline, verifiedOnly ? verifiedPool : pool, from, until, count, rand);
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
    const pastTimeline = modelTimeline(pastQ, points, past.baseline, PAST_OPEN_AT, past.market.closesAt);
    const placed = await simulateTrades(past.market.id, pastTimeline, pool, new Date(PAST_OPEN_AT.getTime() + 3_600_000), new Date(past.market.closesAt.getTime() - 3_600_000), PAST_TRADES.min + Math.floor(rand() * PAST_TRADES.extra), rand);
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
    if (company.id === DEMO_COMPANY) demoEntries.push({ market: past.market, q: pastQ, startupId: startup.id, verifiedOnly: false, outcome: resolution.outcome });
    summary.push(`${company.name} [past] ${pastQ.text} -> resolved ${resolution.outcome} (${fmt(resolution.observedTotal!)}), ${placed} trades, settlement ${settled.status}`);
  }

  const demoStudies = await seedDemoStudies(demoOwnerId, admin.id, demoEntries);

  const [startups, markets, forecasts, facts] = await Promise.all([db.startup.count(), db.market.count(), db.forecast.count(), db.startupFact.count()]);
  console.log(summary.join("\n"));
  console.log(`\nDone: ${startups} startups, ${facts} facts, ${markets} markets, ${forecasts} simulated forecasts.`);
  console.log(`${DEMO_ORG_NAME}: ${demoStudies} studies (PostHog, plus every verified-users question). Verified VC accounts join it on their first /vc visit.`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
