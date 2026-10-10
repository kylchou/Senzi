import { MarketStatus, PlatformRole, SnapshotTrigger } from "../generated/prisma/enums";
import { hashCode, normalizeCode } from "../lib/product-proof";
import { db } from "../lib/db";

/**
 * Demo data for verified product users: a Stripe market only verified Stripe
 * users can trade, and a reusable access code. Safe to run more than once.
 * The seed calls it; for a database that's already seeded, run
 * `npm run db:demo:verified` (prisma/demo-verified.ts).
 */

export const DEMO_ACCESS_CODE = "STRIPE-DEMO";
const MARKET_SLUG = "stripe-us-card-pricing-change-2027";
const DAY = 86_400_000;

export async function seedVerifiedUsersDemo(now = new Date()) {
  const stripe = await db.startup.findUnique({ where: { slug: "stripe" }, select: { id: true } });
  if (!stripe) {
    console.log("No Stripe startup in this database; skipping the verified-users demo.");
    return;
  }
  const admin = await db.user.findFirst({ where: { platformRole: PlatformRole.ADMIN }, orderBy: { createdAt: "asc" }, select: { id: true } });

  if (!(await db.market.findUnique({ where: { slug: MARKET_SLUG }, select: { id: true } }))) {
    const opensAt = now;
    const closesAt = new Date(now.getTime() + 260 * DAY);
    const baseline = 0.2;
    const market = await db.market.create({
      data: {
        slug: MARKET_SLUG,
        startupId: stripe.id,
        question: "Will Stripe change its standard US card fee (2.9% + 30¢) by June 30, 2027?",
        description: "Only verified Stripe users can trade here: they see pricing emails and dashboard notices first.",
        yesCriteria:
          "Resolves YES if Stripe's public US pricing page lists a standard online card fee other than 2.9% + 30¢ at any point before the deadline.",
        noCriteria: "Resolves NO if the standard online card fee on Stripe's US pricing page is still 2.9% + 30¢ at the deadline.",
        category: "Pricing",
        openingBaseline: baseline,
        baselineMethodology: "Admin estimate: Stripe's headline US card fee has rarely changed in recent years.",
        baselineSetAt: opensAt,
        status: MarketStatus.OPEN,
        verifiedUsersOnly: true,
        opensAt,
        closesAt,
        resolvesBy: new Date(closesAt.getTime() + 14 * DAY),
        createdById: admin?.id ?? null,
        sources: {
          create: [{ title: "Stripe pricing (US)", url: "https://stripe.com/pricing", sourceType: "OFFICIAL_RECORD", retrievedAt: opensAt, position: 0 }],
        },
      },
    });
    await db.marketSnapshot.create({
      data: {
        marketId: market.id,
        sequence: 1,
        trigger: SnapshotTrigger.OPENING,
        openingBaseline: baseline,
        yesCredits: 0,
        noCredits: 0,
        forecastCount: 0,
        forecasterCount: 0,
        recordedAt: opensAt,
      },
    });
    console.log(`Created verified-users market /markets/${MARKET_SLUG}`);
  }

  const codeHash = hashCode(DEMO_ACCESS_CODE);
  if (!(await db.productAccessCode.findUnique({ where: { codeHash }, select: { id: true } }))) {
    await db.productAccessCode.create({
      data: {
        startupId: stripe.id,
        codeHash,
        hint: normalizeCode(DEMO_ACCESS_CODE).slice(-4),
        label: "Demo code (unlimited uses)",
        createdById: admin?.id ?? null,
      },
    });
    console.log(`Created demo access code ${DEMO_ACCESS_CODE} for Stripe`);
  }
}
