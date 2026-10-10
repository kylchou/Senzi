import { describe, expect, it } from "vitest";
import { planNotifications, type CreatedAlert, type OrgMember } from "../alert-delivery";
import type { AlertType } from "../types";
import { DAY, NOW, openStudy, setup, users } from "./fixtures";

const members: OrgMember[] = [
  { userId: "owner_a", role: "OWNER" },
  { userId: "analyst_a", role: "ANALYST" },
  { userId: "analyst_a2", role: "ANALYST" },
  { userId: "viewer_a", role: "VIEWER" },
];

function alert(type: AlertType, studyId: string | null): CreatedAlert {
  return {
    id: `alert_${type}_${studyId}`,
    organizationId: "org_a",
    type,
    studyId,
    startupId: null,
    marketId: null,
    title: "t",
    body: "b",
    payload: {},
    dedupeKey: `${type}:${studyId}`,
    createdAt: NOW,
  };
}

describe("planNotifications", () => {
  it("sends org-wide study alerts to every member who can see the study", async () => {
    const s = setup();
    const study = await openStudy(s, { visibility: "ORGANIZATION" });
    const plan = planNotifications([alert("FORECAST_MOVEMENT", study.id)], new Map([["org_a", members]]), new Map([[study.id, study]]));
    expect(plan.map((n) => n.userId).sort()).toEqual(["analyst_a", "analyst_a2", "owner_a", "viewer_a"]);
    expect(plan[0]).toMatchObject({ type: "SYSTEM", link: `/vc/studies/${study.id}` });
    expect(plan[0].data.vcAlertId).toBe(`alert_FORECAST_MOVEMENT_${study.id}`);
  });

  it("never notifies members who can't see a restricted study", async () => {
    const s = setup();
    const study = await openStudy(s, { visibility: "RESTRICTED" });
    const plan = planNotifications([alert("DEADLINE_APPROACHING", study.id)], new Map([["org_a", members]]), new Map([[study.id, study]]));
    // Author and owner only; the other analyst and the viewer weren't invited.
    expect(plan.map((n) => n.userId).sort()).toEqual(["analyst_a", "owner_a"]);
    expect(plan[0].type).toBe("MARKET_CLOSING");
  });

  it("sends status changes only to the author and firm managers", async () => {
    const s = setup();
    const study = await openStudy(s, { visibility: "ORGANIZATION" });
    const plan = planNotifications([alert("STUDY_STATUS_CHANGED", study.id)], new Map([["org_a", members]]), new Map([[study.id, study]]));
    expect(plan.map((n) => n.userId).sort()).toEqual(["analyst_a", "owner_a"]);
  });

  it("skips alerts whose study no longer exists, and other orgs' members", () => {
    const plan = planNotifications(
      [alert("STUDY_RESOLVED", "gone")],
      new Map([["org_a", members], ["org_b", [{ userId: "analyst_b", role: "OWNER" }]]]),
      new Map(),
    );
    expect(plan).toEqual([]);
  });
});

describe("alert publishing", () => {
  it("delivers new alerts to inboxes once, and marking read clears the inbox item", async () => {
    const s = setup();
    for (const [id, role] of [["owner_a", "OWNER"], ["analyst_a", "ANALYST"], ["viewer_a", "VIEWER"]] as const) {
      s.platform.state.memberships.set(id, [{ organizationId: "org_a", organizationName: "Alpha Ventures", role }]);
    }
    await openStudy(s, { deadline: new Date(NOW.getTime() + 2 * DAY) });
    const statusNotes = s.platform.state.notifications.length;
    expect(statusNotes).toBeGreaterThan(0);

    await s.services.alerts.evaluate();
    const deadline = s.platform.state.notifications.filter((n) => n.data.alertType === "DEADLINE_APPROACHING");
    expect(deadline.map((n) => n.userId).sort()).toEqual(["analyst_a", "owner_a", "viewer_a"]);

    // Re-running the cron creates no new alerts, so no new inbox items.
    const before = s.platform.state.notifications.length;
    await s.services.alerts.evaluate();
    expect(s.platform.state.notifications.length).toBe(before);

    const [mine] = await s.services.alerts.list(users.viewerA, { type: "DEADLINE_APPROACHING", limit: 5 });
    await s.services.alerts.markRead(users.viewerA, [mine.id]);
    expect(deadline.find((n) => n.userId === "viewer_a")!.readAt).not.toBeNull();
  });

  it("keeps the alert even if inbox delivery fails", async () => {
    const s = setup();
    s.platform.state.memberships.set("owner_a", [{ organizationId: "org_a", organizationName: "Alpha Ventures", role: "OWNER" }]);
    s.platform.notifyUsers = async () => {
      throw new Error("inbox down");
    };
    const study = await openStudy(s);
    expect(s.repo.alerts.filter((a) => a.studyId === study.id)).toHaveLength(3);
  });
});
