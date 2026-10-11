import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OrgRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { anonymizeDeletedUser, syncProfileFromAuth } from "@/lib/users";
import { makeOrg, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const roleOf = async (organizationId: string, userId: string) =>
  (await db.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId, userId } } }))?.role;

describe("profile sync from Clerk", () => {
  it("updates email and avatar but keeps the name people set in Senzi", async () => {
    const user = await makeUser({ name: "Picked in Senzi" });
    await syncProfileFromAuth(user.authId, { email: "New@Example.com", avatarUrl: "https://img.example/a.png" });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      displayName: "Picked in Senzi",
      email: "new@example.com",
      avatarUrl: "https://img.example/a.png",
    });
  });

  it("keeps the old email instead of failing when another account has the new one", async () => {
    const taken = await makeUser();
    const user = await makeUser();
    await syncProfileFromAuth(user.authId, { email: taken.email, avatarUrl: "https://img.example/b.png" });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ email: user.email, avatarUrl: "https://img.example/b.png" });
  });
});

describe("deleted users", () => {
  it("hands the org to an admin when the last owner deletes their account", async () => {
    const owner = await makeUser({ accountType: "VC" });
    const admin = await makeUser({ accountType: "VC" });
    const viewer = await makeUser({ accountType: "VC" });
    const org = await makeOrg([[owner, OrgRole.OWNER], [viewer, OrgRole.VIEWER], [admin, OrgRole.ADMIN]]);

    await anonymizeDeletedUser(owner.authId);

    expect(await roleOf(org.id, owner.id)).toBeUndefined();
    expect(await roleOf(org.id, admin.id)).toBe(OrgRole.OWNER);
    expect(await roleOf(org.id, viewer.id)).toBe(OrgRole.VIEWER);
    expect(await db.auditLog.count({ where: { organizationId: org.id, action: "organization.member.role" } })).toBe(1);
    expect(await db.user.findUniqueOrThrow({ where: { id: owner.id } })).toMatchObject({ displayName: "Deleted user", avatarUrl: null });
  });

  it("falls back to any member, and leaves orgs with another owner alone", async () => {
    const owner = await makeUser({ accountType: "VC" });
    const coOwner = await makeUser({ accountType: "VC" });
    const viewer = await makeUser({ accountType: "VC" });
    const solo = await makeOrg([[owner, OrgRole.OWNER], [viewer, OrgRole.VIEWER]]);
    const shared = await makeOrg([[owner, OrgRole.OWNER], [coOwner, OrgRole.OWNER], [viewer, OrgRole.ANALYST]]);

    await anonymizeDeletedUser(owner.authId);

    expect(await roleOf(solo.id, viewer.id)).toBe(OrgRole.OWNER);
    expect(await roleOf(shared.id, viewer.id)).toBe(OrgRole.ANALYST);
    expect(await roleOf(shared.id, coOwner.id)).toBe(OrgRole.OWNER);
  });
});
