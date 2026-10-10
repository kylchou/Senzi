import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MarketVisibility, OrgRole, SnapshotTrigger } from "@/generated/prisma/enums";
import { resolveMarket } from "@/lib/admin";
import { db } from "@/lib/db";
import { canViewMarket } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { VcError } from "@/lib/vc/errors";
import { getVcDeps } from "@/lib/vc/server/container";
import { createIndicatorGateway } from "@/lib/vc/server/indicators-adapter";
import { createVcServices } from "@/lib/vc/services";
import type { StudyVisibility, VcContext } from "@/lib/vc/types";
import { makeAdmin, makeMarket, makeOrg, makeStartup, makeUser, placeForecast, resetDatabase } from "../helpers";

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
    expect(await services.studies.syncWithMarkets()).toEqual({ closed: 0, resolved: 1, corrected: 0, failed: 0 });
    const resolved = await services.studies.get(w.ctx.analystA, study.id);
    expect(resolved.study).toMatchObject({ status: "RESOLVED", resolvedOutcome: "YES" });
    expect(resolved.estimate?.resolution?.evidenceUrls).toEqual(["https://example.com/series-b"]);

    // An admin corrects the outcome before settlement completes; the study follows it.
    await db.resolution.update({ where: { marketId: market.id }, data: { outcome: "NO", correctionCount: { increment: 1 } } });
    expect(await services.studies.syncWithMarkets()).toMatchObject({ corrected: 1, failed: 0 });
    expect((await services.studies.get(w.ctx.analystA, study.id)).study.resolvedOutcome).toBe("NO");
    expect(await db.studyEvent.count({ where: { studyId: study.id, action: "correct_resolution" } })).toBe(1);
    await db.resolution.update({ where: { marketId: market.id }, data: { outcome: "YES" } });
    await services.studies.syncWithMarkets();

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

  it("opens public markets, which are listed through their study rather than as plain markets", async () => {
    const w = await world();
    const study = await openStudy(w, "PUBLIC");
    const market = await db.market.findUniqueOrThrow({ where: { id: study.marketId! } });
    expect(market).toMatchObject({ visibility: MarketVisibility.PUBLIC, organizationId: null });
    const plain = await makeMarket(w.admin, { startupId: w.startup.id });
    const listed = await deps.platform.listPublicMarketsForStartups([w.startup.id]);
    expect(listed.map((m) => m.id)).toEqual([plain.id]);
  });

  it("closes the market when the study is closed, so forecasting stops", async () => {
    const w = await world();
    const study = await openStudy(w, "ORGANIZATION");
    await services.studies.transition(w.ctx.admin, study.id, { action: "close", expectedVersion: study.version });
    expect((await db.market.findUniqueOrThrow({ where: { id: study.marketId! } })).status).toBe("CLOSED");
    expect((await deps.repo.findStudy(study.id))!.status).toBe("CLOSED");
    expect(await db.auditLog.count({ where: { action: "market.closeFromStudy", entityId: study.marketId! } })).toBe(1);
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
    expect(await deps.platform.getStartups([hidden.id])).toEqual([]);
    expect((await deps.platform.getStartups([w.startup.id]))[0]).toMatchObject({ id: w.startup.id, industry: "Testing" });
  });

  it("dedupes alerts and keeps watchlist names unique per firm", async () => {
    const w = await world();
    const alert = { organizationId: w.orgA.id, type: "DEADLINE_APPROACHING" as const, title: "t", body: "b", dedupeKey: "k1" };
    expect(await deps.repo.createAlerts([alert])).toHaveLength(1);
    expect(await deps.repo.createAlerts([alert])).toHaveLength(0);
    await services.alerts.markRead(w.ctx.analystA, (await services.alerts.list(w.ctx.analystA, { limit: 10 })).map((a) => a.id));
    expect(await services.alerts.unreadCount(w.ctx.analystA)).toBe(0);
    expect(await services.alerts.unreadCount(w.ctx.ownerA)).toBe(1);

    await services.watchlists.create(w.ctx.analystA, "Core");
    await expectCode(services.watchlists.create(w.ctx.analystA, "Core"), "CONFLICT");
    expect(await services.watchlists.list(w.ctx.ownerB)).toEqual([]);
  });
});

describe("alerts reach personal inboxes", () => {
  it("delivers to members who can see the study and clears them when read in VC", async () => {
    const w = await world();
    const study = await openStudy(w, "RESTRICTED");
    // Status changes reach only the author and firm owners/admins.
    const inbox = async (u: SessionUser) => db.notification.findMany({ where: { userId: u.id } });
    expect((await inbox(w.analystA)).length).toBeGreaterThan(0);
    expect((await inbox(w.ownerA)).length).toBeGreaterThan(0);
    expect(await inbox(w.viewerA)).toEqual([]);
    expect(await inbox(w.ownerB)).toEqual([]);

    const [first] = await services.alerts.list(w.ctx.analystA, { limit: 1 });
    const linked = (await inbox(w.analystA)).find((n) => (n.data as { vcAlertId?: string }).vcAlertId === first.id)!;
    expect(linked).toMatchObject({ link: `/vc/studies/${study.id}`, readAt: null });
    await services.alerts.markRead(w.ctx.analystA, [first.id]);
    expect((await db.notification.findUniqueOrThrow({ where: { id: linked.id } })).readAt).not.toBeNull();
  });
});

describe("startup comparison", () => {
  it("reads public indicators from the model for a startup it tracks", async () => {
    const w = await world();
    const tracked = await db.startup.update({ where: { id: w.startup.id }, data: { slug: "supabase", name: "Supabase" } });
    const other = await makeStartup();
    // Exercises the real model adapter directly; the app uses a placeholder until lib/model can be bundled.
    const c = await createVcServices({ ...deps, indicators: createIndicatorGateway() }).compare.compare(w.ctx.analystA, [
      tracked.id,
      other.id,
    ]);
    expect(c.columns[0].indicators.status).toBe("ok");
    expect(c.columns[0].indicators.rows.length).toBeGreaterThan(0);
    expect(c.columns[0].indicators.rows.every((r) => !/sponsor/i.test(r.provenanceLabel))).toBe(true);
    expect(c.columns[1].indicators.status).toBe("not_tracked");
  });
});


describe("assistant context against the database", () => {
  it("uses real snapshot ids and excludes news tied to private markets or unpublished startups", async () => {
    const w = await world();
    const study = await openStudy(w, "ORGANIZATION");
    const marketId = study.marketId!;
    await placeForecast(w.viewerA, marketId, 100);
    await recordSnapshot(marketId);

    const otherPrivate = await makeMarket(w.admin, { private: w.orgB.id, startupId: w.startup.id });
    await db.startupFact.create({
      data: { startupId: w.startup.id, label: "Series A", value: "$12M", sourceName: "Press release", sourceUrl: "https://example.com/a", asOf: new Date(), verified: true, verifiedAt: new Date() },
    });
    const publicNews = await db.newsItem.create({
      data: { startupId: w.startup.id, title: "Public report", publisher: "Example News", url: "https://example.com/news", publishedAt: new Date() },
    });
    await db.newsItem.create({
      data: { startupId: w.startup.id, marketId: otherPrivate.id, title: "Private-market report", publisher: "Example News", url: "https://example.com/private", publishedAt: new Date() },
    });

    const pkg = await services.assistantContext.forStudy(w.ctx.analystA, study.id);
    const ids = pkg.items.map((i) => i.id);
    expect(ids).toContain(`news:${publicNews.id}`);
    expect(JSON.stringify(pkg)).not.toContain("Private-market report");
    expect(ids.some((id) => id.startsWith("fact:"))).toBe(true);

    const snapshotIds = ids.filter((id) => id.startsWith("snapshot:")).map((id) => id.slice("snapshot:".length));
    expect(snapshotIds.length).toBeGreaterThan(0);
    expect(await db.marketSnapshot.count({ where: { id: { in: snapshotIds }, marketId } })).toBe(snapshotIds.length);

    await db.startup.update({ where: { id: w.startup.id }, data: { isPublished: false } });
    const hidden = await services.assistantContext.forStudy(w.ctx.analystA, study.id);
    expect(hidden.items.some((i) => i.id.startsWith("fact:") || i.id.startsWith("news:"))).toBe(false);
  });

  it("refuses a restricted study at the standard tier", async () => {
    const w = await world();
    const study = await openStudy(w, "RESTRICTED");
    await expectCode(services.assistantContext.forStudy(w.ctx.analystA, study.id), "FORBIDDEN");
  });
});
