import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client";
import {
  AccountType,
  CreditTransactionType,
  EstimateKind,
  ForecastSide,
  MarketStatus,
  MarketVisibility,
  NewsVerification,
  OrgRole,
  PlatformRole,
  ProposalStatus,
  ResolutionOutcome,
  SnapshotTrigger,
  StudyStatus,
  StudyVisibility,
  VcAlertType,
  VoidReason,
  WatchlistItemType,
} from "../generated/prisma/enums";
import { grantSignupCredits } from "../lib/credits";
import { applyTrade, defaultLiquidity, openingState, quoteTrade, sharesForSpend, yesPrice } from "../lib/forecasting/lmsr";
import { LMSR_RULE_ID } from "../lib/forecasting/lmsr-pricing";
import { db } from "../lib/db";
import { seedVerifiedUsersDemo } from "./verified-users-demo";
import { FileModelStore } from "../lib/model";
import { estimateWithModel } from "../lib/vc/model-estimate";
import { PENDING_AUTH_PREFIX, SIGNUP_GRANT_CREDITS } from "../lib/types";
import {
  achievements,
  facts,
  markets,
  modelStartups,
  news,
  SEED_ANCHOR,
  startups,
  users,
  type SeedMarket,
} from "./seed-data";
import {
  arrivalTime,
  beliefFor,
  crowdUsers,
  forecasterTarget,
  forecastsFor,
  normal,
  pickForecasters,
  stakeFor,
  verifiedUsers,
} from "./seed-crowd";

// Deterministic demo data. Run on an empty database:
//   npm run db:reset   (drops, migrates, seeds)
// Set SEED_DEMO_EMAIL to your own email to be made an admin and owner of the
// demo VC org the first time you sign in with it.

const DAY = 24 * 60 * 60 * 1000;
const daysFrom = (days: number) => new Date(SEED_ANCHOR.getTime() + days * DAY);
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** mulberry32: tiny seeded PRNG so every run produces the same forecasts. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  if (await db.startup.findUnique({ where: { slug: startups[0]!.slug } })) {
    console.log("Seed data already present. Run `npm run db:reset` to start over.");
    return;
  }
  const random = rng(20261001);
  // Northstar's members are VC accounts; everyone else trades.
  const VC_HANDLES = new Set(["maya", "theo", "priya"]);

  // --- Users (seed accounts cannot sign in; their authIds are placeholders) ---
  const userIds = new Map<string, string>();
  for (const u of users) {
    const user = await db.user.create({
      data: {
        authId: `seed:${u.handle}`,
        email: `${u.handle}@demo.senzi.invalid`,
        username: u.handle,
        displayName: u.displayName,
        platformRole: u.role === "ADMIN" ? PlatformRole.ADMIN : PlatformRole.USER,
        accountType: VC_HANDLES.has(u.handle) ? AccountType.VC : AccountType.TRADER,
        accountVerifiedAt: new Date(),
      },
    });
    await db.$transaction((tx) => grantSignupCredits(tx, user.id));
    userIds.set(u.handle, user.id);
  }
  // --- Simulated forecaster crowd (prisma/seed-crowd.ts) --------------------
  // About 2,000 fictional forecasters so markets show realistic participation.
  // Inserted in bulk; each still gets its welcome grant as a ledger row.
  const crowdRandom = rng(20261002);
  const crowd = crowdUsers(crowdRandom);
  const crowdIds = crowd.map(() => randomUUID());
  await db.user.createMany({
    data: crowd.map((member, index) => ({
      id: crowdIds[index]!,
      authId: `seed:crowd:${member.handle}`,
      email: `${member.handle}@crowd.senzi.invalid`,
      username: member.handle,
      displayName: member.displayName,
      creditBalance: SIGNUP_GRANT_CREDITS,
    })),
  });
  await db.creditTransaction.createMany({
    data: crowdIds.map((id) => ({
      userId: id,
      amount: SIGNUP_GRANT_CREDITS,
      balanceAfter: SIGNUP_GRANT_CREDITS,
      type: CreditTransactionType.SIGNUP_GRANT,
      idempotencyKey: `signup:${id}`,
      memo: "Welcome grant (virtual credits, no cash value)",
    })),
  });
  crowd.forEach((member, index) => userIds.set(member.handle, crowdIds[index]!));

  const uid = (handle: string) => userIds.get(handle)!;
  const adminId = uid("avery");
  // A second admin approves the seeded resolutions (two-admin rule).
  const reviewerId = uid("jordan");

  const demoEmail = process.env.SEED_DEMO_EMAIL?.trim().toLowerCase();
  let demoUserId: string | null = null;
  if (demoEmail) {
    const demo = await db.user.create({
      data: {
        authId: `${PENDING_AUTH_PREFIX}${demoEmail}`,
        email: demoEmail,
        displayName: demoEmail.split("@")[0]!,
        platformRole: PlatformRole.ADMIN,
        accountType: AccountType.VC,
        accountVerifiedAt: new Date(),
      },
    });
    demoUserId = demo.id;
  }

  // --- Organizations ----------------------------------------------------------
  const northstar = await db.organization.create({
    data: {
      name: "Northstar Ventures",
      slug: "northstar-ventures",
      description: "Demo early-stage fund focused on climate and industrial tech.",
      memberships: {
        create: [
          { userId: uid("maya"), role: OrgRole.OWNER },
          { userId: uid("theo"), role: OrgRole.ANALYST },
          { userId: uid("priya"), role: OrgRole.VIEWER },
          ...(demoUserId ? [{ userId: demoUserId, role: OrgRole.OWNER }] : []),
        ],
      },
    },
  });
  const harbor = await db.organization.create({
    data: {
      name: "Harbor Lane Capital",
      slug: "harbor-lane-capital",
      description: "Demo growth fund investing in software and fintech.",
      memberships: {
        create: [
          { userId: uid("jonas"), role: OrgRole.OWNER },
          { userId: uid("lena"), role: OrgRole.ANALYST },
        ],
      },
    },
  });

  // --- Startups and facts -----------------------------------------------------
  const startupIds = new Map<string, string>();
  for (const s of startups) {
    const row = await db.startup.create({
      data: { ...s, websiteUrl: `https://${s.slug}.example.com`, isPublished: true, isDemo: true, createdById: adminId },
    });
    startupIds.set(s.slug, row.id);
  }
  for (const { domain, ...s } of modelStartups) {
    const row = await db.startup.create({
      data: { ...s, websiteUrl: `https://${domain}`, isPublished: true, isDemo: true, createdById: adminId },
    });
    startupIds.set(s.slug, row.id);
  }
  for (const f of facts) {
    await db.startupFact.create({
      data: {
        startupId: startupIds.get(f.startup)!,
        label: f.label,
        value: f.value,
        sourceName: f.sourceName,
        sourceUrl: `https://${f.startup}.example.com/press`,
        sourceType: "COMPANY_ANNOUNCEMENT",
        asOf: daysFrom(f.days),
        retrievedAt: daysFrom(f.days + 1),
        // Fictional company, so never verified.
        verified: false,
      },
    });
  }

  // --- Markets and forecasts --------------------------------------------------
  const marketIds = new Map<string, string>();
  const forecasters = users.filter((u) => u.role !== "ADMIN").map((u) => u.handle);
  // Mirror of each seed user's balance so stakes never exceed it.
  const balances = new Map([...users, ...crowd].map((u) => [u.handle, SIGNUP_GRANT_CREDITS]));
  const verifiedByStartup = verifiedUsers(
    crowd,
    startups.map((startup) => startup.slug),
    crowdRandom,
  );
  const clampUnit = (value: number) => Math.min(0.97, Math.max(0.03, value));

  type PlannedForecast = { handle: string; time: number; belief: number; verified: boolean; stake?: number };

  /** The original small-group forecasts: named demo users only (private markets, and a few on public ones). */
  function namedPlan(m: SeedMarket, pool: string[], count: number, opensAt: number, windowEnd: number): PlannedForecast[] {
    return Array.from({ length: count }, () => ({
      handle: pool[Math.floor(random() * pool.length)]!,
      time: opensAt + random() * (windowEnd - opensAt),
      belief: clampUnit(m.lean + (random() - 0.5) * 0.3),
      verified: false,
      stake: 10 * (1 + Math.floor(random() * 10)),
    }));
  }

  /** The simulated crowd on a public market (sizes and behavior documented in seed-crowd.ts). */
  function crowdPlan(m: SeedMarket, opensAt: number, windowEnd: number): PlannedForecast[] {
    const verified = verifiedByStartup.get(m.startup) ?? new Set<string>();
    const outcome = m.state === "RESOLVED_YES" ? 1 : m.state === "RESOLVED_NO" ? 0 : null;
    const newsAt = news.filter((item) => item.startup === m.startup).map((item) => daysFrom(item.days).getTime());
    const plan: PlannedForecast[] = [];
    for (const member of pickForecasters(crowd, forecasterTarget(crowdRandom, (windowEnd - opensAt) / DAY), verified, crowdRandom)) {
      const isVerified = verified.has(member.handle);
      const belief = beliefFor(crowdRandom, m.lean, isVerified, outcome);
      const count = forecastsFor(member, crowdRandom);
      for (let k = 0; k < count; k++) {
        plan.push({
          handle: member.handle,
          time: arrivalTime(crowdRandom, opensAt, windowEnd, newsAt),
          // Later forecasts from the same person drift a little from their first view.
          belief: k === 0 ? belief : clampUnit(belief + 0.05 * normal(crowdRandom)),
          verified: isVerified,
        });
      }
    }
    return plan;
  }

  /**
   * Writes a market's forecasts the way the engine would: each one buys LMSR
   * shares at the current price (the General Users line), verified users'
   * trades are replayed on their own (the Verified Users line), stakes are
   * debited in the ledger, and every forecast appends a snapshot. Rows are
   * inserted in bulk; ledger chains are computed in order so they verify.
   */
  async function writeForecasts(marketId: string, m: SeedMarket, plan: PlannedForecast[], firstSnapshot: number) {
    const b = defaultLiquidity.baseB;
    const p0 = yesPrice(openingState(m.baseline, b));
    let general = openingState(m.baseline, b);
    let specialized = openingState(m.baseline, b);
    let yes = 0;
    let no = 0;
    let verifiedCredits = 0;
    const seen = new Set<string>();
    const seenVerified = new Set<string>();
    const forecastRows: Prisma.ForecastCreateManyInput[] = [];
    const ledgerRows: Prisma.CreditTransactionCreateManyInput[] = [];
    const snapshotRows: Prisma.MarketSnapshotCreateManyInput[] = [];

    for (const planned of [...plan].sort((a, b) => a.time - b.time)) {
      const balance = balances.get(planned.handle)!;
      const credits = planned.stake !== undefined ? Math.min(planned.stake, balance - (balance % 10)) : stakeFor(crowdRandom, balance);
      if (credits <= 0) continue;
      const priceBefore = yesPrice(general);
      // Buy the side the forecaster thinks is underpriced; a few go against their view.
      let side = planned.belief > priceBefore ? ForecastSide.YES : ForecastSide.NO;
      if (crowdRandom() < 0.08) side = side === ForecastSide.YES ? ForecastSide.NO : ForecastSide.YES;
      const quote = quoteTrade(general, side, credits);
      const specializedBefore = yesPrice(specialized);
      general = applyTrade(general, side, quote.shares);
      if (planned.verified) {
        specialized = applyTrade(specialized, side, sharesForSpend(specialized, side, credits));
        seenVerified.add(planned.handle);
        verifiedCredits += credits;
      }
      balances.set(planned.handle, balance - credits);
      seen.add(planned.handle);
      if (side === ForecastSide.YES) yes += credits;
      else no += credits;

      const id = randomUUID();
      const sequence = forecastRows.length + 1;
      const createdAt = new Date(planned.time);
      const idempotencyKey = `seed:${m.slug}:${sequence}`;
      forecastRows.push({
        id,
        userId: uid(planned.handle),
        marketId,
        sequence,
        side,
        credits,
        // Most forecasters also state a probability; it feeds calibration scoring.
        statedProbability: crowdRandom() < 0.7 ? Math.round(planned.belief * 100) / 100 : null,
        verifiedAtEntry: planned.verified,
        idempotencyKey,
        requestHash: sha({ marketId, side, credits, idempotencyKey }),
        entry: {
          openingBaseline: m.baseline,
          model: null,
          generalBefore: priceBefore,
          generalAfter: yesPrice(general),
          specializedBefore,
          specializedAfter: yesPrice(specialized),
          estimateRuleId: LMSR_RULE_ID,
          estimateKind: "market_price",
        },
        fill: { b, p0, shares: quote.shares, averagePrice: quote.averagePrice, priceBefore: quote.priceBefore, priceAfter: quote.priceAfter },
        createdAt,
      });
      ledgerRows.push({
        userId: uid(planned.handle),
        amount: -credits,
        balanceAfter: balance - credits,
        type: CreditTransactionType.FORECAST_STAKE,
        idempotencyKey: `forecast:${id}`,
        marketId,
        forecastId: id,
        memo: "Seed forecast stake",
        createdAt,
      });
      snapshotRows.push({
        marketId,
        sequence: firstSnapshot + sequence,
        trigger: SnapshotTrigger.FORECAST,
        forecastId: id,
        openingBaseline: m.baseline,
        yesCredits: yes,
        noCredits: no,
        allocationShare: yes / (yes + no),
        generalEstimate: yesPrice(general),
        specializedEstimate: yesPrice(specialized),
        estimateRuleId: LMSR_RULE_ID,
        estimateKind: EstimateKind.MARKET_PRICE,
        forecastCount: sequence,
        forecasterCount: seen.size,
        specializedForecasters: seenVerified.size,
        specializedCredits: verifiedCredits,
        recordedAt: createdAt,
      });
    }

    await db.$transaction([
      db.forecast.createMany({ data: forecastRows }),
      db.creditTransaction.createMany({ data: ledgerRows }),
      db.marketSnapshot.createMany({ data: snapshotRows }),
    ]);
    // Cached balances follow the ledger rows just written.
    if (seen.size) {
      await db.$executeRaw`
        UPDATE "User" AS u SET "creditBalance" = v.balance, "updatedAt" = now()
        FROM (VALUES ${Prisma.join([...seen].map((handle) => Prisma.sql`(${uid(handle)}, ${balances.get(handle)!}::int)`))}) AS v(id, balance)
        WHERE u."id" = v.id`;
    }
    await db.market.update({
      where: { id: marketId },
      data: { yesCredits: yes, noCredits: no, forecastCount: forecastRows.length },
    });
  }

  for (const m of markets) {
    const status = marketStatus(m);
    const closesAt = daysFrom(m.closesInDays);
    const opensAt = daysFrom(Math.min(-45, m.closesInDays - 60));
    const visibility = m.visibility ?? MarketVisibility.PUBLIC;
    const market = await db.market.create({
      data: {
        slug: m.slug,
        startupId: startupIds.get(m.startup)!,
        question: m.question,
        yesCriteria: m.criteria,
        noCriteria: "Resolves NO if the YES criteria are not met by the deadline.",
        category: m.category,
        openingBaseline: m.baseline,
        baselineMethodology: "Admin estimate from historical base rates for companies at this stage.",
        baselineSetAt: opensAt,
        status: MarketStatus.OPEN, // forecasts first, final status below
        visibility,
        organizationId: visibility === MarketVisibility.PUBLIC ? null : northstar.id,
        opensAt,
        closesAt,
        resolvesBy: new Date(closesAt.getTime() + 30 * DAY),
        createdById: adminId,
        sources: {
          create: [{ title: m.source, url: `https://${m.startup}.example.com/news`, sourceType: "COMPANY_ANNOUNCEMENT", retrievedAt: opensAt, position: 0 }],
        },
      },
    });
    marketIds.set(m.slug, market.id);

    if (status !== MarketStatus.DRAFT) {
      const snapshotSeq = 1;
      await db.marketSnapshot.create({
        data: {
          marketId: market.id,
          sequence: snapshotSeq,
          trigger: SnapshotTrigger.OPENING,
          openingBaseline: m.baseline,
          yesCredits: 0,
          noCredits: 0,
          forecastCount: 0,
          forecasterCount: 0,
          recordedAt: opensAt,
        },
      });

      const windowEnd = Math.min(SEED_ANCHOR.getTime(), closesAt.getTime());
      const start = opensAt.getTime();
      // Private research markets stay small (their org's analysts); public ones get the crowd
      // plus a few named demo users so those profiles have history.
      const plan =
        visibility === MarketVisibility.PUBLIC
          ? [...crowdPlan(m, start, windowEnd), ...namedPlan(m, forecasters, 1 + Math.floor(random() * 3), start, windowEnd)]
          : namedPlan(m, ["maya", "theo"], 3 + Math.floor(random() * 6), start, windowEnd);
      await writeForecasts(market.id, m, plan, snapshotSeq);
    }

    await db.market.update({ where: { id: market.id }, data: { status } });
    const outcome = resolutionOutcome(m);
    if (outcome) {
      // Proposed by one admin, approved by another, like the real workflow.
      const voidReason = outcome === ResolutionOutcome.VOID ? VoidReason.CANCELLED : null;
      const evidenceSummary =
        outcome === ResolutionOutcome.VOID
          ? "The trial site's permit was withdrawn, so the question can no longer be fairly answered. Stakes will be refunded."
          : `Demo resolution: the published record ${outcome === ResolutionOutcome.YES ? "meets" : "does not meet"} the criteria by the deadline.`;
      const evidenceUrl = `https://${m.startup}.example.com/news`;
      const proposedAt = daysFrom(m.closesInDays + 2);
      const approvedAt = daysFrom(m.closesInDays + 3);
      const proposal = await db.resolutionProposal.create({
        data: {
          marketId: market.id,
          outcome,
          voidReason,
          evidenceSummary,
          proposedById: adminId,
          proposedAt,
          evidence: {
            create: [{ title: "Company newsroom (fictional)", url: evidenceUrl, sourceType: "COMPANY_ANNOUNCEMENT", retrievedAt: proposedAt, submittedById: adminId }],
          },
        },
      });
      await db.resolutionProposal.update({
        where: { id: proposal.id },
        data: { status: ProposalStatus.APPROVED, reviewedById: reviewerId, reviewedAt: approvedAt },
      });
      await db.resolution.create({
        data: {
          marketId: market.id,
          outcome,
          voidReason,
          evidenceSummary,
          evidenceUrls: [evidenceUrl],
          resolvedById: adminId,
          resolvedAt: approvedAt,
          approvedById: reviewerId,
          approvedAt,
          currentProposalId: proposal.id,
        },
      });
    }
  }

  // --- Research studies (VC Intelligence) ---------------------------------------
  // Two studies already opened as markets, one waiting for review, one draft.
  type Step = [StudyStatus | null, StudyStatus, string, number];
  const studyEvents = (author: string, steps: Step[]) =>
    steps.map(([fromStatus, toStatus, action, days]) => ({
      actorId: action === "approve" || action === "open" ? adminId : uid(author),
      action,
      fromStatus,
      toStatus,
      createdAt: daysFrom(days),
    }));
  const openedSteps = (days: number): Step[] => [
    [null, StudyStatus.DRAFT, "create", days - 6],
    [StudyStatus.DRAFT, StudyStatus.SUBMITTED, "submit", days - 4],
    [StudyStatus.SUBMITTED, StudyStatus.APPROVED, "approve", days - 1],
    [StudyStatus.APPROVED, StudyStatus.OPEN, "open", days],
  ];
  const noCriteria = "Resolves NO if the YES criteria are not met by the deadline.";

  const tidewater = markets.find((m) => m.slug === "northstar-tidewater-pilot")!;
  const tidewaterStudy = await db.researchStudy.create({
    data: {
      organizationId: northstar.id,
      createdById: uid("theo"),
      startupId: startupIds.get("tidewater-water")!,
      marketId: marketIds.get(tidewater.slug),
      question: tidewater.question,
      yesCriteria: tidewater.criteria,
      noCriteria,
      context: "Diligence input for a possible seed extension.",
      baselineValue: tidewater.baseline,
      baselineMethodology: "Share of comparable water-tech pilots that converted within 12 months.",
      deadline: daysFrom(tidewater.closesInDays),
      visibility: StudyVisibility.ORGANIZATION,
      status: StudyStatus.OPEN,
      submittedAt: daysFrom(-49),
      approvedAt: daysFrom(-46),
      openedAt: daysFrom(-45),
      version: 4,
      sources: { create: [{ url: "https://tidewater-water.example.com/news", title: "Tidewater newsroom" }] },
      events: { create: studyEvents("theo", openedSteps(-45)) },
      notes: {
        create: [{ organizationId: northstar.id, authorId: uid("theo"), body: "Utility procurement cycles look like 6-9 months." }],
      },
    },
  });

  const polymath = markets.find((m) => m.slug === "northstar-polymath-seed")!;
  const polymathStudy = await db.researchStudy.create({
    data: {
      organizationId: northstar.id,
      createdById: uid("theo"),
      startupId: startupIds.get("polymath-labs")!,
      marketId: marketIds.get(polymath.slug),
      question: polymath.question,
      yesCriteria: polymath.criteria,
      noCriteria,
      baselineValue: polymath.baseline,
      baselineMethodology: "Seed close rates for lab-automation companies after a demo day.",
      deadline: daysFrom(polymath.closesInDays),
      visibility: StudyVisibility.RESTRICTED,
      status: StudyStatus.OPEN,
      submittedAt: daysFrom(-49),
      approvedAt: daysFrom(-46),
      openedAt: daysFrom(-45),
      version: 4,
      sources: { create: [{ url: "https://polymath-labs.example.com/news", title: "SEC Form D filings" }] },
      participants: { create: [{ userId: uid("maya"), addedById: uid("theo") }] },
      events: { create: studyEvents("theo", openedSteps(-45)) },
    },
  });

  await db.researchStudy.create({
    data: {
      organizationId: harbor.id,
      createdById: uid("lena"),
      startupId: startupIds.get("meridian-pay")!,
      question: "Will Meridian Pay launch payroll in Brazil by June 30, 2027?",
      yesCriteria: "YES if Meridian Pay publicly lists Brazil as a supported payroll country on or before 2027-06-30.",
      noCriteria: "Resolves NO if Brazil is not listed as supported by the deadline.",
      // No metric measures a country launch, so the model has no opening line: it can be reviewed but not opened.
      deadline: daysFrom(270),
      visibility: StudyVisibility.PUBLIC,
      status: StudyStatus.SUBMITTED,
      submittedAt: daysFrom(-2),
      version: 2,
      sources: { create: [{ url: "https://meridian-pay.example.com/countries", title: "Meridian supported countries" }] },
      events: {
        create: studyEvents("lena", [
          [null, StudyStatus.DRAFT, "create", -5],
          [StudyStatus.DRAFT, StudyStatus.SUBMITTED, "submit", -2],
        ]),
      },
    },
  });

  await db.researchStudy.create({
    data: {
      organizationId: harbor.id,
      createdById: uid("lena"),
      startupId: startupIds.get("ledgerline")!,
      question: "Will Ledgerline announce an acquisition of another company in 2027?",
      yesCriteria: "YES if Ledgerline announces a signed acquisition of another company between 2027-01-01 and 2027-12-31.",
      noCriteria: "Resolves NO if no acquisition is announced in 2027.",
      deadline: daysFrom(455),
      visibility: StudyVisibility.ORGANIZATION,
      status: StudyStatus.DRAFT,
      events: { create: studyEvents("lena", [[null, StudyStatus.DRAFT, "create", -1]]) },
    },
  });

  // An approved study the model priced from Supabase's public npm downloads, ready to open.
  const supabaseId = startupIds.get("supabase")!;
  const supabaseLink = { metricId: "npm_downloads:@supabase/supabase-js", threshold: 38_000_000, targetDate: "2026-12-13" };
  const supabaseLine = estimateWithModel(new FileModelStore(), {
    startup: { id: supabaseId, name: "Supabase", slug: "supabase" },
    link: supabaseLink,
    observations: [],
    asOf: SEED_ANCHOR,
  });
  const supabaseOk = supabaseLine.status === "OK";
  await db.researchStudy.create({
    data: {
      organizationId: northstar.id,
      createdById: uid("theo"),
      startupId: supabaseId,
      question: supabaseLine.question!,
      yesCriteria: supabaseLine.yesCriteria!,
      noCriteria: supabaseLine.noCriteria!,
      context: "Developer adoption check before a follow-on discussion.",
      baselineValue: supabaseOk ? supabaseLine.probability : null,
      baselineMethodology: supabaseOk ? supabaseLine.methodology : null,
      deadline: daysFrom(60),
      visibility: StudyVisibility.ORGANIZATION,
      status: StudyStatus.APPROVED,
      submittedAt: daysFrom(-3),
      approvedAt: daysFrom(-1),
      version: 3,
      // The public source the question resolves from, as the app adds it for linked questions.
      sources: { create: [{ url: supabaseLine.resolutionSource!.url, title: supabaseLine.resolutionSource!.title, publisher: "Public data source" }] },
      events: {
        create: studyEvents("theo", [
          [null, StudyStatus.DRAFT, "create", -4],
          [StudyStatus.DRAFT, StudyStatus.SUBMITTED, "submit", -3],
          [StudyStatus.SUBMITTED, StudyStatus.APPROVED, "approve", -1],
        ]),
      },
      modelEstimate: {
        create: {
          status: supabaseOk ? "OK" : "INSUFFICIENT_DATA",
          metricId: supabaseLink.metricId,
          threshold: supabaseLink.threshold,
          targetDate: new Date(`${supabaseLink.targetDate}T00:00:00Z`),
          probability: supabaseLine.probability,
          low: supabaseLine.low,
          high: supabaseLine.high,
          confidence: supabaseLine.confidence,
          modelVersion: supabaseLine.modelVersion,
          inputsHash: supabaseLine.inputsHash,
          methodology: supabaseLine.methodology,
          notes: supabaseLine.notes,
          inputsUsed: supabaseLine.inputsUsed as object[],
          calculatedAt: SEED_ANCHOR,
          calculatedById: uid("theo"),
        },
      },
    },
  });

  // --- Watchlists and alerts ----------------------------------------------------
  await db.watchlist.create({
    data: {
      organizationId: northstar.id,
      name: "Pipeline",
      createdById: uid("theo"),
      items: {
        create: [
          { type: WatchlistItemType.STARTUP, startupId: startupIds.get("lumen-grid")!, addedById: uid("theo") },
          { type: WatchlistItemType.STARTUP, startupId: startupIds.get("copperline-ev")!, addedById: uid("theo") },
          { type: WatchlistItemType.STUDY, studyId: tidewaterStudy.id, addedById: uid("theo") },
          { type: WatchlistItemType.STUDY, studyId: polymathStudy.id, addedById: uid("theo") },
        ],
      },
    },
  });
  await db.watchlist.create({
    data: {
      organizationId: harbor.id,
      name: "Fintech",
      createdById: uid("jonas"),
      items: {
        create: ["ledgerline", "meridian-pay", "atlas-claims"].map((slug) => ({
          type: WatchlistItemType.STARTUP,
          startupId: startupIds.get(slug)!,
          addedById: uid("jonas"),
        })),
      },
    },
  });
  await db.vcAlert.create({
    data: {
      organizationId: northstar.id,
      type: VcAlertType.DEADLINE_APPROACHING,
      studyId: polymathStudy.id,
      marketId: marketIds.get(polymath.slug),
      title: "Polymath seed study closes in 7 months",
      body: "The forecasting deadline for this study is approaching.",
      dedupeKey: `deadline:${polymathStudy.id}:210d`,
      createdAt: SEED_ANCHOR,
    },
  });

  // --- News, achievements -----------------------------------------------------
  for (const [i, n] of news.entries()) {
    await db.newsItem.create({
      data: {
        startupId: startupIds.get(n.startup)!,
        title: n.title,
        summary: "Fictional article for demo purposes.",
        publisher: n.sourceName,
        url: `https://news.example.com/${n.startup}/${i + 1}`,
        publishedAt: daysFrom(n.days),
        retrievedAt: daysFrom(n.days),
        // Fictional article, so never verified.
        verification: NewsVerification.UNVERIFIED,
        createdById: adminId,
      },
    });
  }
  await db.achievement.createMany({ data: achievements });
  const firstForecast = await db.achievement.findUniqueOrThrow({ where: { key: "first-forecast" } });
  const withForecasts = await db.forecast.findMany({ distinct: ["userId"], select: { userId: true } });
  await db.userAchievement.createMany({
    data: withForecasts.map(({ userId }) => ({ userId, achievementId: firstForecast.id, awardedAt: SEED_ANCHOR })),
  });

  // A Stripe market for verified Stripe users, and the STRIPE-DEMO access code.
  await seedVerifiedUsersDemo(SEED_ANCHOR);

  const counts = {
    users: await db.user.count(),
    startups: await db.startup.count(),
    markets: await db.market.count(),
    forecasts: await db.forecast.count(),
    studies: await db.researchStudy.count(),
    ledgerRows: await db.creditTransaction.count(),
  };
  console.log("Seeded Senzi demo data:", counts);
  if (demoEmail) console.log(`Sign in as ${demoEmail} to claim the demo admin/owner account.`);
}

function marketStatus(m: SeedMarket): MarketStatus {
  switch (m.state) {
    case "RESOLVED_YES":
    case "RESOLVED_NO":
      return MarketStatus.RESOLVED;
    default:
      return MarketStatus[m.state];
  }
}

function resolutionOutcome(m: SeedMarket): ResolutionOutcome | null {
  if (m.state === "RESOLVED_YES") return ResolutionOutcome.YES;
  if (m.state === "RESOLVED_NO") return ResolutionOutcome.NO;
  if (m.state === "CANCELLED") return ResolutionOutcome.VOID;
  return null;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
