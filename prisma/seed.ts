import "dotenv/config";
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
  StudyAccess,
  StudyRole,
  StudyStatus,
} from "../generated/prisma/enums";
import { applyCreditTransaction, grantSignupCredits } from "../lib/credits";
import { db } from "../lib/db";
import { PENDING_AUTH_PREFIX, SIGNUP_GRANT_CREDITS } from "../lib/types";
import {
  achievements,
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

  // --- Startups ---------------------------------------------------------------
  const startupIds = new Map<string, string>();
  for (const s of startups) {
    const row = await db.startup.create({
      data: { ...s, website: `https://${s.slug}.example.com`, isPublished: true, createdById: adminId },
    });
    startupIds.set(s.slug, row.id);
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
    const market = await db.market.create({
      data: {
        slug: m.slug,
        startupId: startupIds.get(m.startup)!,
        question: m.question,
        resolutionCriteria: m.criteria,
        resolutionSource: m.source,
        category: m.category,
        openingBaseline: m.baseline,
        status: MarketStatus.OPEN, // forecasts first, final status below
        visibility: m.visibility ?? MarketVisibility.PUBLIC,
        organizationId: m.visibility === "PRIVATE" ? northstar.id : null,
        opensAt,
        closesAt,
        resolvesBy: new Date(closesAt.getTime() + 30 * DAY),
        createdById: adminId,
      },
    });
    marketIds.set(m.slug, market.id);

    if (status !== MarketStatus.DRAFT) {
      await db.probabilitySnapshot.create({
        data: {
          marketId: market.id,
          trigger: SnapshotTrigger.OPENING,
          openingBaseline: m.baseline,
          yesCredits: 0,
          noCredits: 0,
          forecastCount: 0,
          uniqueForecasters: 0,
          capturedAt: opensAt,
        },
      });

      const pool = m.visibility === "PRIVATE" ? ["maya", "theo", "priya"] : forecasters;
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

        await db.$transaction(async (tx) => {
          const forecast = await tx.forecast.create({
            data: {
              userId: uid(handle),
              marketId: market.id,
              side,
              credits,
              statedProbability: Math.round(stated * 100) / 100,
              idempotencyKey: `seed:${m.slug}:${i}`,
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
        });

        if (side === ForecastSide.YES) yes += credits;
        else no += credits;
        seen.add(handle);
        await db.probabilitySnapshot.create({
          data: {
            marketId: market.id,
            trigger: SnapshotTrigger.FORECAST,
            openingBaseline: m.baseline,
            yesCredits: yes,
            noCredits: no,
            communityAllocationShare: yes / (yes + no),
            forecastCount,
            uniqueForecasters: seen.size,
            capturedAt: createdAt,
          },
        });
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
            outcome === ResolutionOutcome.CANCELLED
              ? "The trial site's permit was withdrawn, so the question can no longer be fairly answered. Stakes will be refunded."
              : `Demo resolution: the published record ${outcome === ResolutionOutcome.YES ? "meets" : "does not meet"} the criteria by the deadline.`,
          evidenceUrls: [`https://${m.startup}.example.com/news`],
          resolvedById: adminId,
          resolvedAt: daysFrom(m.closesInDays + 3),
        },
      });
    }
  }

  // --- Research studies -------------------------------------------------------
  await db.researchStudy.create({
    data: {
      organizationId: northstar.id,
      slug: "climate-infrastructure-2027",
      title: "Climate infrastructure 2027",
      summary: "Which long-duration storage and water companies hit commercial milestones next year.",
      status: StudyStatus.ACTIVE,
      access: StudyAccess.ORGANIZATION,
      createdById: uid("maya"),
      members: { create: [{ userId: uid("theo"), role: StudyRole.LEAD }] },
      startups: {
        create: ["lumen-grid", "tidewater-water", "verdant-soil", "copperline-ev"].map((slug) => ({
          startupId: startupIds.get(slug)!,
          addedById: uid("theo"),
        })),
      },
      markets: {
        create: ["lumen-grid-utility-contract", "northstar-tidewater-pilot", "verdant-registry-approval"].map((slug) => ({
          marketId: marketIds.get(slug)!,
          addedById: uid("theo"),
        })),
      },
    },
  });
  await db.researchStudy.create({
    data: {
      organizationId: northstar.id,
      slug: "lab-automation-diligence",
      title: "Lab automation diligence",
      summary: "Restricted: active diligence on Polymath Labs.",
      status: StudyStatus.ACTIVE,
      access: StudyAccess.RESTRICTED,
      createdById: uid("theo"),
      members: { create: [{ userId: uid("theo"), role: StudyRole.LEAD }] },
      startups: { create: [{ startupId: startupIds.get("polymath-labs")!, addedById: uid("theo") }] },
      markets: { create: [{ marketId: marketIds.get("northstar-polymath-seed")!, addedById: uid("theo") }] },
    },
  });
  await db.researchStudy.create({
    data: {
      organizationId: harbor.id,
      slug: "fintech-back-office",
      title: "Fintech back office",
      summary: "Tracking accounting and payroll infrastructure players.",
      status: StudyStatus.ACTIVE,
      access: StudyAccess.ORGANIZATION,
      createdById: uid("jonas"),
      members: { create: [{ userId: uid("lena"), role: StudyRole.CONTRIBUTOR }] },
      startups: {
        create: ["ledgerline", "meridian-pay", "atlas-claims"].map((slug) => ({
          startupId: startupIds.get(slug)!,
          addedById: uid("lena"),
        })),
      },
      markets: {
        create: ["ledgerline-ipo-filing", "meridian-license"].map((slug) => ({
          marketId: marketIds.get(slug)!,
          addedById: uid("lena"),
        })),
      },
    },
  });

  // --- Watchlists -------------------------------------------------------------
  await db.watchlist.create({
    data: {
      ownerId: uid("theo"),
      organizationId: northstar.id,
      name: "Northstar pipeline",
      items: {
        create: [
          { startupId: startupIds.get("tidewater-water")! },
          { startupId: startupIds.get("polymath-labs")! },
          { marketId: marketIds.get("lumen-grid-series-c-2027")!, alertThreshold: 0.1 },
        ],
      },
    },
  });
  await db.watchlist.create({
    data: {
      ownerId: uid("sam"),
      name: "My watchlist",
      items: {
        create: [
          { startupId: startupIds.get("stackwise")! },
          { marketId: marketIds.get("fieldnote-salesforce-app")!, alertThreshold: 0.05 },
        ],
      },
    },
  });

  // --- News, achievements -----------------------------------------------------
  for (const [i, n] of news.entries()) {
    await db.newsItem.create({
      data: {
        startupId: startupIds.get(n.startup)!,
        title: n.title,
        summary: "Fictional article for demo purposes.",
        sourceName: n.sourceName,
        sourceUrl: `https://news.example.com/${n.startup}/${i + 1}`,
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
  if (m.state === "CANCELLED") return ResolutionOutcome.CANCELLED;
  return null;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
