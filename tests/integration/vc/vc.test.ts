import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MarketVisibility, OrgRole, SnapshotTrigger } from "@/generated/prisma/enums";
import { resolveMarket } from "@/lib/admin";
import { db } from "@/lib/db";
import { canViewMarket } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { VcError } from "@/lib/vc/errors";
import { getVcDeps } from "@/lib/vc/server/container";
import { createVcServices } from "@/lib/vc/services";
import type { StudyVisibility, VcContext } from "@/lib/vc/types";
import { makeAdmin, makeOrg, makeStartup, makeUser, placeForecast, resetDatabase } from "../helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const DAY = 24 * 60 * 60 * 1000;
const deps = getVcDeps();
const services = createVcServices(deps);

async function ctxFor(user: SessionUser, isPlatformAdmin = false): Promise<VcContext> {
  const memberships = await deps.platform.getMemberships(user.id);
  return {
    user: { id: user.id, name: user.displayName, email: user.email, isPlatformAdmin },
    memberships,
    activeOrg: memberships[0] ?? null,
  };
}

async function expectCode(promise: Promise<unknown>, code: VcError["code"]) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof VcError && e.code === code);
}

/** Firm A (owner, analyst, viewer), firm B (owner), an outside expert, and a platform admin. */
async function world() {
  const [admin, ownerA, analystA, viewerA, ownerB, expert] = await Promise.all([
    makeAdmin(),
    makeUser(),
    makeUser(),
    makeUser(),
    makeUser(),
    makeUser(),
  ]);
  const orgA = await makeOrg([
    [ownerA, OrgRole.OWNER],
    [analystA, OrgRole.ANALYST],
    [viewerA, OrgRole.VIEWER],
  ]);
  const orgB = await makeOrg([[ownerB, OrgRole.OWNER]]);
  const startup = await makeStartup();
  return {
    admin, ownerA, analystA, viewerA, ownerB, expert, orgA, orgB, startup,
    ctx: {
      admin: await ctxFor(admin, true),
      ownerA: await ctxFor(ownerA),
      analystA: await ctxFor(analystA),
      viewerA: await ctxFor(viewerA),
      ownerB: await ctxFor(ownerB),
      expert: await ctxFor(expert),
    },
  };
}

type World = Awaited<ReturnType<typeof world>>;

/** Creates a study as the analyst and drives it through review to OPEN. */
async function openStudy(w: World, visibility: StudyVisibility) {
  const draft = await services.studies.create(w.ctx.analystA, {
    startupId: w.startup.id,
    question: "Will this startup announce a Series B by the deadline?",
    yesCriteria: "A Series B of at least $20M is announced publicly before the deadline.",
    noCriteria: "No qualifying Series B is announced publicly before the deadline.",
    context: null,
    baselineValue: 0.35,
    baselineMethodology: "Base rate for comparable Series A companies in the sector.",
    deadline: new Date(Date.now() + 30 * DAY),
    visibility,
    sources: [{ url: "https://example.com/series-a", title: "Series A announcement" }],
  });
  if (visibility === "RESTRICTED") {
    await services.studies.setParticipants(w.ctx.analystA, draft.id, { userIds: [w.expert.id], emails: [] });
  }
  await services.studies.transition(w.ctx.analystA, draft.id, { action: "submit", expectedVersion: 1 });
  await services.studies.transition(w.ctx.admin, draft.id, { action: "approve", expectedVersion: 2 });
  await services.studies.transition(w.ctx.admin, draft.id, { action: "open", expectedVersion: 3 });
  return (await deps.repo.findStudy(draft.id))!;
}

async function recordSnapshot(marketId: string) {
  const m = await db.market.findUniqueOrThrow({ where: { id: marketId } });
  const forecasters = await db.forecast.findMany({ where: { marketId }, distinct: ["userId"], select: { userId: true } });
  const sequence = (await db.marketSnapshot.count({ where: { marketId } })) + 1;
  await db.marketSnapshot.create({
    data: {
      marketId,
      sequence,
      trigger: SnapshotTrigger.FORECAST,
      openingBaseline: m.openingBaseline,
      yesCredits: m.yesCredits,
      noCredits: m.noCredits,
      allocationShare: m.yesCredits + m.noCredits > 0 ? m.yesCredits / (m.yesCredits + m.noCredits) : null,
      forecastCount: m.forecastCount,
      forecasterCount: forecasters.length,
    },
  });
}

describe("study lifecycle against the shared schema", () => {
  it("opens an organization market through createMarketForStudy and mirrors its resolution", async () => {
    const w = await world();
    const study = await openStudy(w, "ORGANIZATION");
    expect(study.status).toBe("OPEN");

    const market = await db.market.findUniqueOrThrow({ where: { id: study.marketId! }, include: { sources: true } });
    expect(market).toMatchObject({
      visibility: MarketVisibility.ORGANIZATION,
      organizationId: w.orgA.id,
      openingBaseline: 0.35,
      baselineMethodology: "Base rate for comparable Series A companies in the sector.",
      status: "OPEN",
    });
    expect(market.sources.map((s) => s.url)).toEqual(["https://example.com/series-a"]);
    expect(await canViewMarket(w.viewerA.id, market.id)).toBe(true);
    expect(await canViewMarket(w.ownerB.id, market.id)).toBe(false);
    expect(await canViewMarket(null, market.id)).toBe(false);

    await placeForecast(w.viewerA, market.id, 100);
    await recordSnapshot(market.id);
    const detail = await services.studies.get(w.ctx.viewerA, study.id);
    expect(detail.estimate).toMatchObject({
      openingBaseline: { value: 0.35 },
      allocation: { yesCredits: 100, noCredits: 0, yesShare: 1 },
      participantCount: 1,
      forecastCount: 1,
      calibratedProbability: null,
    });
    expect(detail.history.at(-1)?.yesShare).toBe(1);

    await resolveMarket(w.admin, market.id, {
      outcome: "YES",
      evidenceSummary: "The company announced a $25M Series B in a press release.",
      evidenceUrls: ["https://example.com/series-b"],
    });
    expect(await services.studies.syncWithMarkets()).toEqual({ closed: 0, resolved: 1 });
    const resolved = await services.studies.get(w.ctx.analystA, study.id);
    expect(resolved.study).toMatchObject({ status: "RESOLVED", resolvedOutcome: "YES" });
    expect(resolved.estimate?.resolution?.evidenceUrls).toEqual(["https://example.com/series-b"]);

    const report = await services.reports.generate(w.ctx.analystA, study.id);
    expect(report.resolution?.outcome).toBe("YES");
    expect(report.communityEstimate?.yesAllocationShare).toBe(1);
  });

  it("opens restricted markets visible only to firm admins, the author, and participants", async () => {
    const w = await world();
    const study = await openStudy(w, "RESTRICTED");
    const marketId = study.marketId!;
    expect((await db.market.findUniqueOrThrow({ where: { id: marketId } })).visibility).toBe(MarketVisibility.RESTRICTED);
    expect(await canViewMarket(w.expert.id, marketId)).toBe(true);
    expect(await canViewMarket(w.ownerA.id, marketId)).toBe(true);
    expect(await canViewMarket(w.analystA.id, marketId)).toBe(true);
    expect(await canViewMarket(w.viewerA.id, marketId)).toBe(false);
    expect(await canViewMarket(w.ownerB.id, marketId)).toBe(false);
    await expectCode(services.studies.get(w.ctx.viewerA, study.id), "NOT_FOUND");
    expect((await services.studies.get(w.ctx.expert, study.id)).permissions.viewLevel).toBe("limited");
  });

  it("opens public markets that appear in public listings", async () => {
    const w = await world();
    const study = await openStudy(w, "PUBLIC");
    const market = await db.market.findUniqueOrThrow({ where: { id: study.marketId! } });
    expect(market).toMatchObject({ visibility: MarketVisibility.PUBLIC, organizationId: null });
    const listed = await deps.platform.listPublicMarketsForStartups([w.startup.id]);
    expect(listed.map((m) => m.id)).toEqual([market.id]);
  });

  it("keeps other firms out of private studies, notes, and reports", async () => {
    const w = await world();
    const study = await openStudy(w, "ORGANIZATION");
    await services.studies.addNote(w.ctx.analystA, study.id, "Private thesis");
    await expectCode(services.studies.get(w.ctx.ownerB, study.id), "NOT_FOUND");
    await expectCode(services.studies.listNotes(w.ctx.ownerB, study.id), "NOT_FOUND");
    await expectCode(services.reports.generate(w.ctx.ownerB, study.id), "NOT_FOUND");
    expect(await services.studies.list(w.ctx.ownerB, { scope: "public" })).toEqual([]);
  });

  it("rejects stale versions with CONFLICT and records every transition", async () => {
    const w = await world();
    const draft = await services.studies.create(w.ctx.analystA, {
      startupId: w.startup.id,
      question: "Will this startup ship its product publicly this year?",
      yesCriteria: "The product is generally available to customers before the deadline.",
      noCriteria: "The product is not generally available to customers by the deadline.",
      baselineValue: null,
      baselineMethodology: null,
      deadline: new Date(Date.now() + 10 * DAY),
      visibility: "ORGANIZATION",
    });
    await services.studies.update(w.ctx.analystA, draft.id, { context: "First edit", expectedVersion: 1 });
    await expectCode(services.studies.update(w.ctx.analystA, draft.id, { context: "Stale", expectedVersion: 1 }), "CONFLICT");
    await expectCode(services.studies.transition(w.ctx.analystA, draft.id, { action: "submit", expectedVersion: 2 }), "VALIDATION_ERROR");
    const events = await db.studyEvent.findMany({ where: { studyId: draft.id } });
    expect(events.map((e) => e.action)).toEqual(["create"]);
  });
});

describe("adapters", () => {
  it("maps memberships, users, and startups from the shared tables", async () => {
    const w = await world();
    expect(await deps.platform.getMemberships(w.analystA.id)).toEqual([
      { organizationId: w.orgA.id, organizationName: w.orgA.name, role: "ANALYST" },
    ]);
    const [found] = await deps.platform.findUsersByEmail([w.viewerA.email.toUpperCase()]);
    expect(found).toEqual({ id: w.viewerA.id, name: w.viewerA.displayName, email: w.viewerA.email });

    const hidden = await db.startup.update({ where: { id: (await makeStartup()).id }, data: { isPublished: false, name: "Hidden Co" } });
    expect(await deps.platform.searchStartups("Hidden", 10)).toEqual([]);
    expect((await deps.platform.getStartups([w.startup.id]))[0]).toMatchObject({ id: w.startup.id, industry: "Testing" });
    expect(hidden.isPublished).toBe(false);
  });

  it("dedupes alerts and keeps watchlist names unique per firm", async () => {
    const w = await world();
    const alert = { organizationId: w.orgA.id, type: "DEADLINE_APPROACHING" as const, title: "t", body: "b", dedupeKey: "k1" };
    expect(await deps.repo.createAlerts([alert])).toBe(1);
    expect(await deps.repo.createAlerts([alert])).toBe(0);
    await services.alerts.markRead(w.ctx.analystA, (await services.alerts.list(w.ctx.analystA, { limit: 10 })).map((a) => a.id));
    expect(await services.alerts.unreadCount(w.ctx.analystA)).toBe(0);
    expect(await services.alerts.unreadCount(w.ctx.ownerA)).toBe(1);

    await services.watchlists.create(w.ctx.analystA, "Core");
    await expectCode(services.watchlists.create(w.ctx.analystA, "Core"), "CONFLICT");
    expect(await services.watchlists.list(w.ctx.ownerB)).toEqual([]);
  });
});
