import { describe, expect, it } from "vitest";
import { alertsForSubject } from "../services/alerts";
import { makeEstimate } from "../testing/memory";
import type { EstimatePoint } from "../types";
import { DAY, NOW, openStudy, setup, users } from "./fixtures";

const HOUR = 3600_000;
const pts = (pairs: [number, number][]): EstimatePoint[] =>
  pairs.map(([hoursAgo, share]) => ({
    at: new Date(NOW.getTime() - hoursAgo * HOUR),
    yesShare: share,
    totalCredits: 1000,
    participantCount: 12,
  }));

const subject = {
  kind: "study" as const,
  id: "s1",
  marketId: "m1",
  startupId: "startup_1",
  question: "Will Acme raise?",
  status: "OPEN" as const,
  closesAt: new Date(NOW.getTime() + 30 * DAY),
};

describe("alert rules", () => {
  it("fires a movement alert at ≥10 points over 24h and labels it as allocation share", () => {
    const alerts = alertsForSubject("org_a", subject, makeEstimate("m1"), pts([[30, 0.4], [1, 0.55]]), NOW);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe("FORECAST_MOVEMENT");
    expect(alerts[0].body).toMatch(/not a calibrated probability/);
    expect(alerts[0].dedupeKey).toBe("movement:study:s1:2026-10-01");
  });

  it("ignores small movements and thin participation", () => {
    expect(alertsForSubject("org_a", subject, makeEstimate("m1"), pts([[30, 0.4], [1, 0.45]]), NOW)).toEqual([]);
    expect(
      alertsForSubject("org_a", subject, makeEstimate("m1", { participantCount: 2 }), pts([[30, 0.1], [1, 0.9]]), NOW),
    ).toEqual([]);
  });

  it("ignores markets newer than the window", () => {
    expect(alertsForSubject("org_a", subject, makeEstimate("m1"), pts([[3, 0.1], [1, 0.9]]), NOW)).toEqual([]);
  });

  it("fires a deadline alert within 3 days", () => {
    const soon = { ...subject, closesAt: new Date(NOW.getTime() + 2 * DAY) };
    const alerts = alertsForSubject("org_a", soon, makeEstimate("m1"), [], NOW);
    expect(alerts.map((a) => a.type)).toEqual(["DEADLINE_APPROACHING"]);
  });
});

describe("alert evaluation and visibility", () => {
  it("is idempotent and respects study permissions per user", async () => {
    const s = setup();
    const restricted = await openStudy(s, { visibility: "RESTRICTED", deadline: new Date(NOW.getTime() + 2 * DAY) });
    s.forecasting.estimates.set(restricted.marketId!, makeEstimate(restricted.marketId!));

    const first = await s.services.alerts.evaluate();
    expect(first.created).toBeGreaterThan(0);
    expect((await s.services.alerts.evaluate()).created).toBe(0);

    // The author sees the deadline alert; a viewer in the same firm does not.
    const authorAlerts = await s.services.alerts.list(users.analystA, { limit: 50 });
    expect(authorAlerts.some((a) => a.type === "DEADLINE_APPROACHING")).toBe(true);
    expect(await s.services.alerts.list(users.viewerA, { limit: 50 })).toEqual([]);
    // Another firm never gets them.
    expect(await s.services.alerts.list(users.analystB, { limit: 50 })).toEqual([]);
  });

  it("alerts other firms that follow a public study, but not a private one", async () => {
    const s = setup();
    const pub = await openStudy(s, { visibility: "PUBLIC", deadline: new Date(NOW.getTime() + 2 * DAY) });
    const priv = await openStudy(s, { visibility: "ORGANIZATION", deadline: new Date(NOW.getTime() + 2 * DAY) });
    const wl = await s.repo.createWatchlist({ organizationId: "org_b", name: "Follow", createdById: "analyst_b" });
    // Insert directly to simulate a stale watchlist entry for a now-private study.
    await s.repo.addWatchlistItem({ watchlistId: wl!.id, type: "STUDY", studyId: pub.id, startupId: null, addedById: "analyst_b" });
    await s.repo.addWatchlistItem({ watchlistId: wl!.id, type: "STUDY", studyId: priv.id, startupId: null, addedById: "analyst_b" });

    await s.services.alerts.evaluate();
    const bAlerts = await s.services.alerts.list(users.analystB, { limit: 50 });
    expect(bAlerts.map((a) => a.studyId)).toEqual([pub.id]);
  });

  it("tracks read state per user", async () => {
    const s = setup();
    await openStudy(s);
    const [alert] = await s.services.alerts.list(users.analystA, { limit: 1 });
    await s.services.alerts.markRead(users.analystA, [alert.id]);
    expect(await s.services.alerts.unreadCount(users.analystA)).toBe(2);
    expect(await s.services.alerts.unreadCount(users.ownerA)).toBe(3);
    // Marking another org's alert id is ignored.
    await s.services.alerts.markRead(users.analystB, [alert.id]);
    expect(s.repo.receipts.has(`${alert.id}:analyst_b`)).toBe(false);
  });
});
