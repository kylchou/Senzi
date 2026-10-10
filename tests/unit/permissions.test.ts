import { describe, expect, it } from "vitest";
import { OrgRole } from "@/generated/prisma/enums";
import { canTransitionMarket, termsAreEditable } from "@/lib/admin";
import { canManageMember, hasOrgRole, PUBLIC_MARKET_WHERE } from "@/lib/permissions";

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

describe("public market filter", () => {
  it("only lets public, non-draft markets of published startups through", () => {
    expect(PUBLIC_MARKET_WHERE).toEqual({
      visibility: "PUBLIC",
      status: { not: "DRAFT" },
      startup: { isPublished: true },
    });
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
