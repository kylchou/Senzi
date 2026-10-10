import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OrgRole, StudyAccess, StudyRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addMember, changeMemberRole, listMembers, removeMember } from "@/lib/organizations";
import {
  readableStudiesWhere,
  requireOrgRole,
  requireStudyAccess,
  requireWatchlistAccess,
  visibleMarketsWhere,
} from "@/lib/permissions";
import { makeAdmin, makeMarket, makeOrg, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function makeStudy(organizationId: string, access: StudyAccess, members: [string, StudyRole][] = []) {
  return db.researchStudy.create({
    data: {
      organizationId,
      slug: `study-${Math.random().toString(36).slice(2, 8)}`,
      title: "Study",
      access,
      members: { create: members.map(([userId, role]) => ({ userId, role })) },
    },
  });
}

describe("organization isolation", () => {
  it("hides one org's studies, watchlists, and private markets from another org", async () => {
    const admin = await makeAdmin();
    const alice = await makeUser();
    const bob = await makeUser();
    const orgA = await makeOrg([[alice, OrgRole.OWNER]]);
    await makeOrg([[bob, OrgRole.OWNER]]);

    const study = await makeStudy(orgA.id, StudyAccess.ORGANIZATION);
    const watchlist = await db.watchlist.create({ data: { ownerId: alice.id, organizationId: orgA.id, name: "A" } });
    const privateMarket = await makeMarket(admin, { private: orgA.id });

    await expect(requireStudyAccess(bob, study.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requireWatchlistAccess(bob, watchlist.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requireOrgRole(bob, orgA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.researchStudy.count({ where: readableStudiesWhere(bob.id) })).toBe(0);
    expect(await db.market.count({ where: { id: privateMarket.id, ...visibleMarketsWhere(bob.id) } })).toBe(0);
    expect(await db.market.count({ where: { id: privateMarket.id, ...visibleMarketsWhere(alice.id) } })).toBe(1);
    expect(await db.market.count({ where: { id: privateMarket.id, ...visibleMarketsWhere(null) } })).toBe(0);
  });

  it("does not give platform admins access to org research", async () => {
    const admin = await makeAdmin();
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    const study = await makeStudy(org.id, StudyAccess.ORGANIZATION);
    await expect(requireStudyAccess(admin, study.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("limits restricted studies to their members and org admins", async () => {
    const owner = await makeUser();
    const analyst = await makeUser();
    const lead = await makeUser();
    const org = await makeOrg([
      [owner, OrgRole.OWNER],
      [analyst, OrgRole.ANALYST],
      [lead, OrgRole.ANALYST],
    ]);
    const study = await makeStudy(org.id, StudyAccess.RESTRICTED, [[lead.id, StudyRole.LEAD]]);

    await expect(requireStudyAccess(analyst, study.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requireStudyAccess(lead, study.id, "manage")).resolves.toBeTruthy();
    await expect(requireStudyAccess(owner, study.id, "manage")).resolves.toBeTruthy();
    expect(await db.researchStudy.count({ where: readableStudiesWhere(analyst.id) })).toBe(0);
    expect(await db.researchStudy.count({ where: readableStudiesWhere(lead.id) })).toBe(1);
  });
});

describe("membership management", () => {
  it("invites unknown emails as pending members", async () => {
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    await addMember(owner, org.id, { email: "new.analyst@fund.example", role: OrgRole.ANALYST });
    const members = await listMembers(owner, org.id);
    expect(members.find((m) => m.email === "new.analyst@fund.example")).toMatchObject({ pending: true, role: "ANALYST" });
  });

  it("stops org admins from granting admin or touching owners", async () => {
    const owner = await makeUser();
    const orgAdmin = await makeUser();
    const org = await makeOrg([
      [owner, OrgRole.OWNER],
      [orgAdmin, OrgRole.ADMIN],
    ]);
    await expect(
      addMember(orgAdmin, org.id, { email: "x@fund.example", role: OrgRole.ADMIN }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(removeMember(orgAdmin, org.id, owner.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps at least one owner", async () => {
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    await expect(changeMemberRole(owner, org.id, owner.id, OrgRole.ADMIN)).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
    await expect(removeMember(owner, org.id, owner.id)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("removes study access along with org membership", async () => {
    const owner = await makeUser();
    const analyst = await makeUser();
    const org = await makeOrg([
      [owner, OrgRole.OWNER],
      [analyst, OrgRole.ANALYST],
    ]);
    const study = await makeStudy(org.id, StudyAccess.RESTRICTED, [[analyst.id, StudyRole.CONTRIBUTOR]]);
    await removeMember(owner, org.id, analyst.id);
    expect(await db.studyMembership.count({ where: { studyId: study.id } })).toBe(0);
    await expect(requireStudyAccess(analyst, study.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
