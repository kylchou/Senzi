import "dotenv/config";
import { createHash } from "node:crypto";
import {
  CreditTransactionType,
  ForecastSide,
  MarketStatus,
  MarketVisibility,
  NewsVerification,
  OrgRole,
  PlatformRole,
  ResolutionOutcome,
  SnapshotTrigger,
  StudyStatus,
  StudyVisibility,
  VcAlertType,
  WatchlistItemType,
} from "../generated/prisma/enums";
import { applyCreditTransaction, grantSignupCredits } from "../lib/credits";
import { db } from "../lib/db";
import { PENDING_AUTH_PREFIX, SIGNUP_GRANT_CREDITS } from "../lib/types";
import {
  achievements,
  facts,
  markets,
  news,
  SEED_ANCHOR,
  startups,
  users,
  type SeedMarket,
} from "./seed-data";

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
      },
    });
    await db.$transaction((tx) => grantSignupCredits(tx, user.id));
    userIds.set(u.handle, user.id);
  }
  const uid = (handle: string) => userIds.get(handle)!;
  const adminId = uid("avery");

  const demoEmail = process.env.SEED_DEMO_EMAIL?.trim().toLowerCase();
  let demoUserId: string | null = null;
  if (demoEmail) {
    const demo = await db.user.create({
      data: {
        authId: `${PENDING_AUTH_PREFIX}${demoEmail}`,
        email: demoEmail,
        displayName: demoEmail.split("@")[0]!,
        platformRole: PlatformRole.ADMIN,
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
      data: { ...s, websiteUrl: `https://${s.slug}.example.com`, isPublished: true, createdById: adminId },
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
        asOf: daysFrom(f.days),
        verified: f.verified,
      },
    });
  }

  // --- Markets and forecasts --------------------------------------------------
  const marketIds = new Map<string, string>();
  const forecasters = users.filter((u) => u.role !== "ADMIN").map((u) => u.handle);
  // Mirror of each seed user's balance so stakes never exceed it.
  const balances = new Map(users.map((u) => [u.handle, SIGNUP_GRANT_CREDITS]));

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
          create: [{ title: m.source, url: `https://${m.startup}.example.com/news`, position: 0 }],
        },
      },
    });
    marketIds.set(m.slug, market.id);

    if (status !== MarketStatus.DRAFT) {
      let snapshotSeq = 1;
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

      const pool = visibility === MarketVisibility.PUBLIC ? forecasters : ["maya", "theo"];
      const count = 3 + Math.floor(random() * 6);
      const windowEnd = Math.min(SEED_ANCHOR.getTime(), closesAt.getTime());
      const times = Array.from({ length: count }, () => opensAt.getTime() + random() * (windowEnd - opensAt.getTime())).sort((a, b) => a - b);
      let yes = 0;
      let no = 0;
      let forecastCount = 0;
      const seen = new Set<string>();

      for (const [i, time] of times.entries()) {
        const handle = pool[Math.floor(random() * pool.length)]!;
        const stated = Math.min(0.97, Math.max(0.03, m.lean + (random() - 0.5) * 0.3));
        const side = random() < stated ? ForecastSide.YES : ForecastSide.NO;
        const credits = Math.min(10 * (1 + Math.floor(random() * 10)), balances.get(handle)! - (balances.get(handle)! % 10));
        if (credits <= 0) continue;
        balances.set(handle, balances.get(handle)! - credits);
        const createdAt = new Date(time);
        forecastCount += 1;

        const before = yes + no > 0 ? yes / (yes + no) : null;
        const nextYes = yes + (side === ForecastSide.YES ? credits : 0);
        const nextNo = no + (side === ForecastSide.NO ? credits : 0);
        const after = nextYes / (nextYes + nextNo);
        const idempotencyKey = `seed:${m.slug}:${i}`;
        const sequence = forecastCount;
        snapshotSeq += 1;
        const snapshotSequence = snapshotSeq;
        seen.add(handle);
        const forecasterCount = seen.size;

        await db.$transaction(async (tx) => {
          const forecast = await tx.forecast.create({
            data: {
              userId: uid(handle),
              marketId: market.id,
              sequence,
              side,
              credits,
              statedProbability: Math.round(stated * 100) / 100,
              idempotencyKey,
              requestHash: sha({ marketId: market.id, side, credits, idempotencyKey }),
              entry: { openingBaseline: m.baseline, generalBefore: before, generalAfter: after, estimateKind: "ALLOCATION_SHARE" },
              createdAt,
            },
          });
          await applyCreditTransaction(tx, {
            userId: uid(handle),
            amount: -credits,
            type: CreditTransactionType.FORECAST_STAKE,
            idempotencyKey: `forecast:${forecast.id}`,
            marketId: market.id,
            forecastId: forecast.id,
            memo: "Seed forecast stake",
          });
          await tx.marketSnapshot.create({
            data: {
              marketId: market.id,
              sequence: snapshotSequence,
              trigger: SnapshotTrigger.FORECAST,
              forecastId: forecast.id,
              openingBaseline: m.baseline,
              yesCredits: nextYes,
              noCredits: nextNo,
              allocationShare: after,
              forecastCount: sequence,
              forecasterCount,
              recordedAt: createdAt,
            },
          });
        });
        yes = nextYes;
        no = nextNo;
      }
      await db.market.update({
        where: { id: market.id },
        data: { yesCredits: yes, noCredits: no, forecastCount },
      });
    }

    await db.market.update({ where: { id: market.id }, data: { status } });
    const outcome = resolutionOutcome(m);
    if (outcome) {
      await db.resolution.create({
        data: {
          marketId: market.id,
          outcome,
          evidenceSummary:
            outcome === ResolutionOutcome.VOID
              ? "The trial site's permit was withdrawn, so the question can no longer be fairly answered. Stakes will be refunded."
              : `Demo resolution: the published record ${outcome === ResolutionOutcome.YES ? "meets" : "does not meet"} the criteria by the deadline.`,
          evidenceUrls: [`https://${m.startup}.example.com/news`],
          resolvedById: adminId,
          resolvedAt: daysFrom(m.closesInDays + 3),
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
      baselineValue: 0.35,
      baselineMethodology: "Historical pace of Meridian's country launches.",
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
        verification: n.verified ? NewsVerification.VERIFIED : NewsVerification.UNVERIFIED,
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
