import { describe, expect, it } from "vitest";
import { OrgRole, StudyAccess, StudyRole } from "@/generated/prisma/enums";
import { canTransitionMarket, termsAreEditable } from "@/lib/admin";
import { canManageMember, computeStudyPermissions, hasOrgRole } from "@/lib/permissions";

describe("org roles", () => {
  it("ranks OWNER > ADMIN > ANALYST > VIEWER", () => {
    expect(hasOrgRole(OrgRole.OWNER, OrgRole.ADMIN)).toBe(true);
    expect(hasOrgRole(OrgRole.ANALYST, OrgRole.ANALYST)).toBe(true);
    expect(hasOrgRole(OrgRole.VIEWER, OrgRole.ANALYST)).toBe(false);
    expect(hasOrgRole(null, OrgRole.VIEWER)).toBe(false);
  });

  it("lets owners manage anyone and admins only analysts/viewers", () => {
    expect(canManageMember(OrgRole.OWNER, { kind: "add", newRole: OrgRole.OWNER })).toBe(true);
    expect(canManageMember(OrgRole.ADMIN, { kind: "add", newRole: OrgRole.ANALYST })).toBe(true);
    expect(canManageMember(OrgRole.ADMIN, { kind: "add", newRole: OrgRole.ADMIN })).toBe(false);
    expect(canManageMember(OrgRole.ADMIN, { kind: "remove", targetRole: OrgRole.OWNER })).toBe(false);
    expect(
      canManageMember(OrgRole.ADMIN, { kind: "changeRole", targetRole: OrgRole.VIEWER, newRole: OrgRole.ANALYST }),
    ).toBe(true);
    expect(canManageMember(OrgRole.ANALYST, { kind: "remove", targetRole: OrgRole.VIEWER })).toBe(false);
  });
});

describe("study permissions", () => {
  const study = (orgRole: OrgRole | null, studyRole: StudyRole | null, access: StudyAccess = StudyAccess.ORGANIZATION) =>
    computeStudyPermissions({ orgRole, studyRole, access });

  it("gives nothing to non-members, whatever the study role says", () => {
    expect(study(null, StudyRole.LEAD)).toEqual({ canRead: false, canEdit: false, canManage: false });
  });

  it("gives org owners and admins full access", () => {
    expect(study(OrgRole.ADMIN, null, StudyAccess.RESTRICTED)).toEqual({ canRead: true, canEdit: true, canManage: true });
  });

  it("lets every member read org-wide studies but only listed members read restricted ones", () => {
    expect(study(OrgRole.VIEWER, null).canRead).toBe(true);
    expect(study(OrgRole.ANALYST, null, StudyAccess.RESTRICTED).canRead).toBe(false);
    expect(study(OrgRole.ANALYST, StudyRole.VIEWER, StudyAccess.RESTRICTED).canRead).toBe(true);
  });

  it("keeps org viewers read-only even as study leads", () => {
    expect(study(OrgRole.VIEWER, StudyRole.LEAD)).toEqual({ canRead: true, canEdit: false, canManage: false });
  });

  it("separates editing (contributors) from managing (leads)", () => {
    expect(study(OrgRole.ANALYST, StudyRole.CONTRIBUTOR)).toEqual({ canRead: true, canEdit: true, canManage: false });
    expect(study(OrgRole.ANALYST, StudyRole.LEAD).canManage).toBe(true);
  });
});

describe("market rules", () => {
  it("only allows the documented status transitions", () => {
    expect(canTransitionMarket("DRAFT", "OPEN")).toBe(true);
    expect(canTransitionMarket("OPEN", "CLOSED")).toBe(true);
    expect(canTransitionMarket("CLOSED", "OPEN")).toBe(true);
    expect(canTransitionMarket("OPEN", "RESOLVED")).toBe(false);
    expect(canTransitionMarket("RESOLVED", "OPEN")).toBe(false);
    expect(canTransitionMarket("DRAFT", "CLOSED")).toBe(false);
  });

  it("freezes terms once a market has forecasts", () => {
    expect(termsAreEditable({ status: "DRAFT", forecastCount: 0 })).toBe(true);
    expect(termsAreEditable({ status: "OPEN", forecastCount: 0 })).toBe(true);
    expect(termsAreEditable({ status: "OPEN", forecastCount: 3 })).toBe(false);
    expect(termsAreEditable({ status: "CLOSED", forecastCount: 0 })).toBe(false);
  });
});
