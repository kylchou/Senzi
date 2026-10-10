import { describe, expect, it } from "vitest";
import { VcError } from "../errors";
import { makeEstimate } from "../testing/memory";
import { DAY, NOW, openStudy, setup, users, validStudyInput } from "./fixtures";

async function expectCode(p: Promise<unknown>, code: VcError["code"]) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof VcError && e.code === code);
}

describe("study creation and editing", () => {
  it("creates a draft in the active organization with an audit event", async () => {
    const s = setup();
    const study = await s.services.studies.create(users.analystA, validStudyInput());
    expect(study).toMatchObject({ status: "DRAFT", organizationId: "org_a", createdById: "analyst_a", version: 1 });
    expect(s.repo.events.filter((e) => e.studyId === study.id).map((e) => e.action)).toEqual(["create"]);
  });

  it("rejects viewers, users without a firm, and unknown startups", async () => {
    const s = setup();
    await expectCode(s.services.studies.create(users.viewerA, validStudyInput()), "FORBIDDEN");
    await expectCode(s.services.studies.create(users.outsider, validStudyInput()), "FORBIDDEN");
    await expectCode(s.services.studies.create(users.analystA, validStudyInput({ startupId: "nope" })), "VALIDATION_ERROR");
  });

  it("rejects deadlines in the past", async () => {
    const s = setup();
    await expectCode(
      s.services.studies.create(users.analystA, validStudyInput({ deadline: new Date(NOW.getTime() - DAY) })),
      "VALIDATION_ERROR",
    );
  });

  it("uses optimistic concurrency on edits", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    await s.services.studies.update(users.analystA, draft.id, { context: "Updated", expectedVersion: 1 });
    await expectCode(
      s.services.studies.update(users.analystA, draft.id, { context: "Stale", expectedVersion: 1 }),
      "CONFLICT",
    );
    expect((await s.repo.findStudy(draft.id))!.context).toBe("Updated");
  });

  it("does not allow editing after submission", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    await s.services.studies.transition(users.analystA, draft.id, { action: "submit", expectedVersion: 1 });
    await expectCode(
      s.services.studies.update(users.analystA, draft.id, { context: "x", expectedVersion: 2 }),
      "CONFLICT",
    );
  });

  it("keeps baseline and methodology paired on edit", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    await expectCode(
      s.services.studies.update(users.analystA, draft.id, { baselineMethodology: null, expectedVersion: 1 }),
      "VALIDATION_ERROR",
    );
  });
});

describe("full lifecycle", () => {
  it("runs Draft → Submitted → Approved → Open → Closed → Resolved", async () => {
    const s = setup();
    const opened = await openStudy(s);
    expect(opened.status).toBe("OPEN");
    expect(opened.marketId).toBe(`mkt_${opened.id}`);
    expect(opened.submittedAt && opened.approvedAt && opened.openedAt).toBeTruthy();
    expect(s.platform.state.createdMarkets).toHaveLength(1);

    // Deadline passes → system closes.
    s.setNow(new Date(opened.deadline.getTime() + 1000));
    expect(await s.services.studies.syncWithMarkets()).toEqual({ closed: 1, resolved: 0, failed: 0 });
    expect((await s.repo.findStudy(opened.id))!.status).toBe("CLOSED");

    // Market resolved, system mirrors it.
    s.forecasting.estimates.set(
      opened.marketId!,
      makeEstimate(opened.marketId!, {
        status: "RESOLVED",
        resolution: { outcome: "YES", resolvedAt: s.deps.now(), evidenceUrls: ["https://example.com/pr"], evidenceSummary: "Press release" },
      }),
    );
    expect(await s.services.studies.syncWithMarkets()).toEqual({ closed: 0, resolved: 1, failed: 0 });
    const resolved = (await s.repo.findStudy(opened.id))!;
    expect(resolved).toMatchObject({ status: "RESOLVED", resolvedOutcome: "YES" });

    // Re-running is a no-op.
    expect(await s.services.studies.syncWithMarkets()).toEqual({ closed: 0, resolved: 0, failed: 0 });
    const actions = s.repo.events.filter((e) => e.studyId === opened.id).map((e) => e.action);
    expect(actions).toEqual(["create", "submit", "approve", "open", "close", "resolve"]);
    expect(s.repo.events.find((e) => e.action === "close")!.actorId).toBeNull();
  });

  it("emits status alerts for the owning org", async () => {
    const s = setup();
    await openStudy(s);
    const types = s.repo.alerts.filter((a) => a.organizationId === "org_a").map((a) => a.payload.status);
    expect(types).toEqual(["SUBMITTED", "APPROVED", "OPEN"]);
    expect(s.repo.alerts.some((a) => a.organizationId !== "org_a")).toBe(false);
  });

  it("does not create a second market when opening is retried", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    await s.services.studies.transition(users.analystA, draft.id, { action: "submit", expectedVersion: 1 });
    await s.services.studies.transition(users.admin, draft.id, { action: "approve", expectedVersion: 2 });
    // Simulate a market created by an earlier attempt that failed before the status write.
    await s.platform.createMarketForStudy({ studyId: draft.id } as never);
    await s.services.studies.transition(users.admin, draft.id, { action: "open", expectedVersion: 3 });
    expect(s.platform.state.createdMarkets).toHaveLength(1);
    expect((await s.repo.findStudy(draft.id))!.marketId).toBe(`mkt_${draft.id}`);
  });

  it("rejects stale versions and invalid transitions", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    await expectCode(
      s.services.studies.transition(users.analystA, draft.id, { action: "submit", expectedVersion: 99 }),
      "CONFLICT",
    );
    await expectCode(
      s.services.studies.transition(users.admin, draft.id, { action: "approve", expectedVersion: 1 }),
      "NOT_FOUND", // admins cannot see drafts at all
    );
    await s.services.studies.transition(users.analystA, draft.id, { action: "submit", expectedVersion: 1 });
    await expectCode(
      s.services.studies.transition(users.analystA, draft.id, { action: "open", expectedVersion: 2 }),
      "INVALID_STATE",
    );
    await expectCode(
      s.services.studies.transition(users.ownerA, draft.id, { action: "approve", expectedVersion: 2 }),
      "FORBIDDEN",
    );
  });

  it("requires a reason to reject, then supports revise and resubmit", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    await s.services.studies.transition(users.analystA, draft.id, { action: "submit", expectedVersion: 1 });
    await expectCode(
      s.services.studies.transition(users.admin, draft.id, { action: "reject", expectedVersion: 2 }),
      "VALIDATION_ERROR",
    );
    await s.services.studies.transition(users.admin, draft.id, {
      action: "reject",
      reason: "Criteria are not measurable",
      expectedVersion: 2,
    });
    expect((await s.repo.findStudy(draft.id))!).toMatchObject({ status: "REJECTED", rejectionReason: "Criteria are not measurable" });
    await s.services.studies.transition(users.analystA, draft.id, { action: "revise", expectedVersion: 3 });
    expect((await s.repo.findStudy(draft.id))!).toMatchObject({ status: "DRAFT", rejectionReason: null });
  });

  it("supports cancellation before opening", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    await s.services.studies.transition(users.ownerA, draft.id, { action: "cancel", reason: "Superseded", expectedVersion: 1 });
    expect((await s.repo.findStudy(draft.id))!).toMatchObject({ status: "CANCELLED", cancellationReason: "Superseded" });
  });

  it("blocks submitting incomplete studies", async () => {
    const s = setup();
    const draft = await s.services.studies.create(
      users.analystA,
      validStudyInput({ baselineValue: null, baselineMethodology: null }),
    );
    await expectCode(
      s.services.studies.transition(users.analystA, draft.id, { action: "submit", expectedVersion: 1 }),
      "VALIDATION_ERROR",
    );
  });
});

describe("access control through the service", () => {
  it("returns NOT_FOUND to other firms and leaves them out of listings", async () => {
    const s = setup();
    const opened = await openStudy(s);
    await expectCode(s.services.studies.get(users.analystB, opened.id), "NOT_FOUND");
    expect(await s.services.studies.list(users.analystB, { scope: "organization" })).toEqual([]);
    expect(await s.services.studies.list(users.analystB, { scope: "public" })).toEqual([]);
    await expectCode(s.services.studies.listNotes(users.analystB, opened.id), "NOT_FOUND");
    await expectCode(s.services.studies.addNote(users.analystB, opened.id, "hi"), "NOT_FOUND");
  });

  it("shows published public studies to other firms without private data", async () => {
    const s = setup();
    const opened = await openStudy(s, { visibility: "PUBLIC" });
    await s.services.studies.addNote(users.analystA, opened.id, "Our private thesis");
    const detail = await s.services.studies.get(users.analystB, opened.id);
    expect(detail.permissions.viewLevel).toBe("limited");
    expect(detail.participants).toBeNull();
    expect(detail.study.participantIds).toBeNull();
    expect(detail.events.every((e) => e.actorId === null && e.reason === null)).toBe(true);
    await expectCode(s.services.studies.listNotes(users.analystB, opened.id), "NOT_FOUND");
    const listed = await s.services.studies.list(users.analystB, { scope: "public" });
    expect(listed.map((r) => r.study.id)).toEqual([opened.id]);
  });

  it("restricts restricted studies to invited participants", async () => {
    const s = setup();
    const opened = await openStudy(s, { visibility: "RESTRICTED" });
    await expectCode(s.services.studies.get(users.viewerA, opened.id), "NOT_FOUND");
    const ext = await s.services.studies.get(users.external, opened.id);
    expect(ext.permissions.viewLevel).toBe("limited");
    const participating = await s.services.studies.list(users.external, { scope: "participating" });
    expect(participating.map((r) => r.study.id)).toEqual([opened.id]);
    // Org listing for a viewer does not include it either.
    expect(await s.services.studies.list(users.viewerA, { scope: "organization" })).toEqual([]);
  });

  it("validates participant emails", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput({ visibility: "RESTRICTED" }));
    await expectCode(
      s.services.studies.setParticipants(users.analystA, draft.id, { userIds: [], emails: ["ghost@example.com"] }),
      "VALIDATION_ERROR",
    );
    const added = await s.services.studies.setParticipants(users.analystA, draft.id, {
      userIds: [],
      emails: ["external@example.com"],
    });
    expect(added.map((u) => u.id)).toEqual(["external"]);
    // A firm viewer cannot even see a restricted study they were not invited to.
    await expectCode(
      s.services.studies.setParticipants(users.viewerA, draft.id, { userIds: [], emails: [] }),
      "NOT_FOUND",
    );
    // An invited firm analyst can see it but cannot manage participants.
    await s.services.studies.setParticipants(users.analystA, draft.id, { userIds: ["external", "analyst_a2"], emails: [] });
    await expectCode(
      s.services.studies.setParticipants(users.analystA2, draft.id, { userIds: [], emails: [] }),
      "FORBIDDEN",
    );
  });

  it("only lets authors or managers delete notes", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    const note = await s.services.studies.addNote(users.analystA, draft.id, "note");
    await expectCode(s.services.studies.deleteNote(users.analystA2, draft.id, note.id), "FORBIDDEN");
    await s.services.studies.deleteNote(users.ownerA, draft.id, note.id);
    expect(await s.services.studies.listNotes(users.analystA, draft.id)).toEqual([]);
  });

  it("shows platform admins the review queue only", async () => {
    const s = setup();
    const draft = await s.services.studies.create(users.analystA, validStudyInput());
    expect(await s.services.studies.listReviewQueue(users.admin)).toEqual([]);
    await s.services.studies.transition(users.analystA, draft.id, { action: "submit", expectedVersion: 1 });
    expect((await s.services.studies.listReviewQueue(users.admin)).map((r) => r.study.id)).toEqual([draft.id]);
    await expectCode(s.services.studies.listReviewQueue(users.ownerA), "FORBIDDEN");
  });
});
