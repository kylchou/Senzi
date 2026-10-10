import { describe, expect, it } from "vitest";
import { TRANSITIONS, actionsFrom, checkDeadline, getTransitionIssues, isEditable } from "../lifecycle";
import type { Study } from "../types";
import { DAY, NOW } from "./fixtures";

const base: Study = {
  id: "s1",
  organizationId: "org_a",
  createdById: "analyst_a",
  startupId: "startup_1",
  marketId: null,
  question: "Will Acme raise a Series B by 2027?",
  yesCriteria: "Announced round",
  noCriteria: "No round",
  context: null,
  baselineValue: 0.3,
  baselineMethodology: "Base rate of comparable companies",
  deadline: new Date(NOW.getTime() + 30 * DAY),
  visibility: "ORGANIZATION",
  status: "DRAFT",
  rejectionReason: null,
  cancellationReason: null,
  submittedAt: null,
  approvedAt: null,
  openedAt: null,
  closedAt: null,
  resolvedAt: null,
  resolvedOutcome: null,
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
  sources: [],
  participantIds: [],
};

describe("study lifecycle", () => {
  it("follows Draft → Submitted → Approved → Open → Closed → Resolved", () => {
    expect(TRANSITIONS.submit).toMatchObject({ from: ["DRAFT"], to: "SUBMITTED" });
    expect(TRANSITIONS.approve).toMatchObject({ from: ["SUBMITTED"], to: "APPROVED" });
    expect(TRANSITIONS.open).toMatchObject({ from: ["APPROVED"], to: "OPEN" });
    expect(TRANSITIONS.close).toMatchObject({ from: ["OPEN"], to: "CLOSED" });
    expect(TRANSITIONS.resolve.to).toBe("RESOLVED");
  });

  it("has no outgoing transitions from terminal states", () => {
    expect(actionsFrom("RESOLVED")).toEqual([]);
    expect(actionsFrom("CANCELLED")).toEqual([]);
  });

  it("allows rejected studies to be revised back to draft", () => {
    expect(actionsFrom("REJECTED")).toEqual(["revise"]);
  });

  it("does not allow cancelling once forecasting has opened", () => {
    expect(TRANSITIONS.cancel.from).not.toContain("OPEN");
    expect(TRANSITIONS.cancel.from).not.toContain("CLOSED");
  });

  it("keeps approval and opening with platform reviewers and resolution with the system", () => {
    expect(TRANSITIONS.approve.actors).toEqual(["platformAdmin"]);
    expect(TRANSITIONS.open.actors).toEqual(["platformAdmin"]);
    expect(TRANSITIONS.resolve.actors).toEqual(["system"]);
  });

  it("requires reasons for rejection and cancellation", () => {
    expect(TRANSITIONS.reject.requiresReason).toBe(true);
    expect(TRANSITIONS.cancel.requiresReason).toBe(true);
  });

  it("only drafts are editable", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("SUBMITTED")).toBe(false);
    expect(isEditable("OPEN")).toBe(false);
  });

  it("blocks submission without a baseline methodology", () => {
    const issues = getTransitionIssues("submit", { ...base, baselineMethodology: null }, NOW);
    expect(issues[0]).toMatch(/baseline/i);
  });

  it("blocks restricted studies without participants", () => {
    const issues = getTransitionIssues("submit", { ...base, visibility: "RESTRICTED" }, NOW);
    expect(issues.join(" ")).toMatch(/participant/i);
  });

  it("blocks opening once the deadline is too close", () => {
    const issues = getTransitionIssues("open", { ...base, deadline: new Date(NOW.getTime() + 3600_000) }, NOW);
    expect(issues.join(" ")).toMatch(/24 hours/);
  });

  it("validates deadline bounds", () => {
    expect(checkDeadline(new Date(NOW.getTime() + 2 * DAY), NOW)).toBeNull();
    expect(checkDeadline(new Date(NOW.getTime() - DAY), NOW)).not.toBeNull();
    expect(checkDeadline(new Date(NOW.getTime() + 4 * 365 * DAY), NOW)).not.toBeNull();
  });
});
