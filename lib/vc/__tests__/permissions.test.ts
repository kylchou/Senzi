import { describe, expect, it } from "vitest";
import { getStudyPermissions, organizationCanFollowStudy, redactStudy } from "../permissions";
import type { Study, StudyStatus, StudyVisibility } from "../types";
import { NOW, ctxFor, users } from "./fixtures";

function study(visibility: StudyVisibility, status: StudyStatus, extra: Partial<Study> = {}): Study {
  return {
    id: "s1",
    organizationId: "org_a",
    createdById: "analyst_a",
    startupId: "startup_1",
    marketId: status === "OPEN" ? "m1" : null,
    question: "Will Acme raise a Series B by 2027?",
    yesCriteria: "yes",
    noCriteria: "no",
    context: null,
    baselineValue: 0.3,
    baselineMethodology: "Base rate",
    deadline: NOW,
    visibility,
    openToPublic: visibility === "PUBLIC",
    openToVerified: false,
    prizePoolCredits: 0,
    prizeDistributedAt: null,
    status,
    rejectionReason: "Too vague",
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
    participantIds: ["external"],
    ...extra,
  };
}

describe("organization isolation", () => {
  it("hides organization-private studies from other firms in every status", () => {
    for (const status of ["DRAFT", "SUBMITTED", "OPEN", "RESOLVED"] as StudyStatus[]) {
      expect(getStudyPermissions(users.analystB, study("ORGANIZATION", status)).viewLevel).toBe("none");
      expect(getStudyPermissions(users.outsider, study("ORGANIZATION", status)).viewLevel).toBe("none");
    }
  });

  it("hides PUBLIC studies from outsiders until they are published", () => {
    expect(getStudyPermissions(users.analystB, study("PUBLIC", "DRAFT")).canView).toBe(false);
    expect(getStudyPermissions(users.analystB, study("PUBLIC", "SUBMITTED")).canView).toBe(false);
    expect(getStudyPermissions(users.analystB, study("PUBLIC", "OPEN")).viewLevel).toBe("limited");
  });

  it("never gives other firms private access to PUBLIC studies", () => {
    const p = getStudyPermissions(users.analystB, study("PUBLIC", "OPEN"));
    expect(p.canViewPrivate).toBe(false);
    expect(p.canGenerateReports).toBe(false);
    expect(p.canWriteNotes).toBe(false);
  });

  it("gives firm members full access to non-restricted studies", () => {
    const p = getStudyPermissions(users.viewerA, study("ORGANIZATION", "OPEN"));
    expect(p.viewLevel).toBe("full");
    expect(p.canWriteNotes).toBe(false); // viewers are read-only
    expect(p.canGenerateReports).toBe(true);
  });
});

describe("restricted studies", () => {
  it("limits firm members who are not managers, author or participants", () => {
    expect(getStudyPermissions(users.viewerA, study("RESTRICTED", "OPEN")).viewLevel).toBe("none");
    expect(getStudyPermissions(users.analystA2, study("RESTRICTED", "OPEN")).viewLevel).toBe("none");
  });

  it("gives the author and firm managers full access", () => {
    expect(getStudyPermissions(users.analystA, study("RESTRICTED", "OPEN")).viewLevel).toBe("full");
    expect(getStudyPermissions(users.ownerA, study("RESTRICTED", "OPEN")).viewLevel).toBe("full");
  });

  it("gives invited firm members full access", () => {
    const s = study("RESTRICTED", "OPEN", { participantIds: ["analyst_a2"] });
    expect(getStudyPermissions(users.analystA2, s).viewLevel).toBe("full");
  });

  it("gives external participants limited access only once open", () => {
    expect(getStudyPermissions(users.external, study("RESTRICTED", "APPROVED")).viewLevel).toBe("none");
    const p = getStudyPermissions(users.external, study("RESTRICTED", "OPEN"));
    expect(p.viewLevel).toBe("limited");
    expect(p.canViewPrivate).toBe(false);
  });
});

describe("lifecycle actions", () => {
  it("lets the author submit and cancel a draft but not approve it", () => {
    const p = getStudyPermissions(users.analystA, study("ORGANIZATION", "DRAFT"));
    expect(p.allowedActions).toEqual(expect.arrayContaining(["submit", "cancel"]));
    expect(p.allowedActions).not.toContain("approve");
    expect(p.canEdit).toBe(true);
  });

  it("does not let other analysts edit someone else's draft", () => {
    const p = getStudyPermissions(users.analystA2, study("ORGANIZATION", "DRAFT"));
    expect(p.canEdit).toBe(false);
    expect(p.allowedActions).toEqual([]);
  });

  it("lets viewers do nothing", () => {
    const p = getStudyPermissions(users.viewerA, study("ORGANIZATION", "DRAFT"));
    expect(p.allowedActions).toEqual([]);
    expect(p.canEdit).toBe(false);
  });

  it("lets platform admins review submitted studies without seeing drafts", () => {
    expect(getStudyPermissions(users.admin, study("ORGANIZATION", "DRAFT")).canView).toBe(false);
    const p = getStudyPermissions(users.admin, study("ORGANIZATION", "SUBMITTED"));
    expect(p.viewLevel).toBe("limited");
    expect(p.allowedActions).toEqual(expect.arrayContaining(["approve", "reject", "cancel"]));
    expect(p.canViewPrivate).toBe(false);
  });

  it("does not let a firm approve its own study", () => {
    const p = getStudyPermissions(users.ownerA, study("ORGANIZATION", "SUBMITTED"));
    expect(p.allowedActions).not.toContain("approve");
    expect(p.allowedActions).not.toContain("open");
  });

  it("never exposes the system-only resolve action", () => {
    for (const ctx of Object.values(users)) {
      expect(getStudyPermissions(ctx, study("ORGANIZATION", "OPEN")).allowedActions).not.toContain("resolve");
    }
  });
});

describe("redaction", () => {
  it("strips participant ids and review reasons for limited viewers", () => {
    const s = study("PUBLIC", "OPEN");
    const view = redactStudy(users.analystB, s, getStudyPermissions(users.analystB, s));
    expect(view.participantIds).toBeNull();
    expect(view.rejectionReason).toBeNull();
    expect(view.viewLevel).toBe("limited");
  });

  it("keeps rejection reasons for platform reviewers", () => {
    const s = study("ORGANIZATION", "REJECTED");
    const view = redactStudy(users.admin, s, getStudyPermissions(users.admin, s));
    expect(view.rejectionReason).toBe("Too vague");
  });
});

describe("org following", () => {
  it("lets organizations follow only their own or published public studies", () => {
    expect(organizationCanFollowStudy("org_a", study("RESTRICTED", "OPEN"))).toBe(true);
    expect(organizationCanFollowStudy("org_b", study("ORGANIZATION", "OPEN"))).toBe(false);
    expect(organizationCanFollowStudy("org_b", study("PUBLIC", "OPEN"))).toBe(true);
    expect(organizationCanFollowStudy("org_b", study("PUBLIC", "DRAFT"))).toBe(false);
  });

  it("treats users with no memberships as having no firm access", () => {
    expect(getStudyPermissions(ctxFor("nobody"), study("ORGANIZATION", "OPEN")).canView).toBe(false);
  });
});
