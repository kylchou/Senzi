import { randomUUID } from "node:crypto";
import { MarketStatus, OrgRole, PlatformRole, StartupStage } from "@/generated/prisma/enums";
import { createMarket } from "@/lib/admin";
import { grantSignupCredits } from "@/lib/credits";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/types";

const DAY = 24 * 60 * 60 * 1000;

/** Empties every table. TRUNCATE skips the append-only row triggers. */
export async function resetDatabase() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function makeUser(
  opts: { admin?: boolean; credits?: boolean; name?: string } = {},
): Promise<SessionUser> {
  const tag = randomUUID().slice(0, 8);
  const user = await db.user.create({
    data: {
      authId: `test:${tag}`,
      email: `${tag}@test.senzi.invalid`,
      displayName: opts.name ?? `User ${tag}`,
      platformRole: opts.admin ? PlatformRole.ADMIN : PlatformRole.USER,
    },
    select: { id: true, authId: true, email: true, username: true, displayName: true, avatarUrl: true, platformRole: true },
  });
  if (opts.credits !== false) await db.$transaction((tx) => grantSignupCredits(tx, user.id));
  return user;
}

export const makeAdmin = () => makeUser({ admin: true, credits: false });

export async function makeOrg(members: [SessionUser, OrgRole][]) {
  const tag = randomUUID().slice(0, 8);
  return db.organization.create({
    data: {
      name: `Org ${tag}`,
      slug: `org-${tag}`,
      memberships: { create: members.map(([user, role]) => ({ userId: user.id, role })) },
    },
  });
}

export async function makeStartup() {
  const tag = randomUUID().slice(0, 8);
  return db.startup.create({
    data: {
      slug: `startup-${tag}`,
      name: `Startup ${tag}`,
      tagline: "Test startup",
      description: "A startup used in tests.",
      sector: "Testing",
      stage: StartupStage.SEED,
      isPublished: true,
    },
  });
}

export async function makeMarket(
  admin: SessionUser,
  opts: { open?: boolean; private?: string; startupId?: string } = {},
) {
  const startupId = opts.startupId ?? (await makeStartup()).id;
  const now = Date.now();
  return createMarket(admin, {
    slug: `market-${randomUUID().slice(0, 8)}`,
    startupId,
    question: "Will this test market resolve YES?",
    resolutionCriteria: "Resolves YES if the integration test says so before the deadline.",
    openingBaseline: 0.4,
    visibility: opts.private ? "PRIVATE" : "PUBLIC",
    organizationId: opts.private ?? null,
    opensAt: new Date(now - DAY),
    closesAt: new Date(now + 30 * DAY),
    resolvesBy: null,
    openImmediately: opts.open ?? true,
  });
}

/** Minimal stand-in for the forecasting engine: stake credits and record a forecast. */
export async function placeForecast(user: SessionUser, marketId: string, credits = 100) {
  const { applyCreditTransaction } = await import("@/lib/credits");
  return db.$transaction(async (tx) => {
    const forecast = await tx.forecast.create({
      data: { userId: user.id, marketId, side: "YES", credits, idempotencyKey: randomUUID() },
    });
    await applyCreditTransaction(tx, {
      userId: user.id,
      amount: -credits,
      type: "FORECAST_STAKE",
      idempotencyKey: `forecast:${forecast.id}`,
      marketId,
      forecastId: forecast.id,
    });
    await tx.market.update({
      where: { id: marketId },
      data: { yesCredits: { increment: credits }, forecastCount: { increment: 1 } },
    });
    return forecast;
  });
}

export { MarketStatus };
