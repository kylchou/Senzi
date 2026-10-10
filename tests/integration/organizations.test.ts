import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OrgRole, StudyStatus } from "@/generated/prisma/enums";
import { closeMarketForStudy, createMarketForStudy } from "@/lib/admin";
import { db } from "@/lib/db";
import { addMember, changeMemberRole, listMembers, removeMember } from "@/lib/organizations";
import { canViewMarket, requireOrgRole, visibleMarketsWhere } from "@/lib/permissions";
import type { SessionUser } from "@/lib/types";
import { makeAdmin, makeMarket, makeOrg, makeStartup, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const DAY = 24 * 60 * 60 * 1000;

async function makeStudy(
  organizationId: string,
  author: SessionUser,
  opts: { status?: StudyStatus; participants?: SessionUser[] } = {},
) {
  const startup = await makeStartup();
  return db.researchStudy.create({
    data: {
      organizationId,
      createdById: author.id,
      startupId: startup.id,
      question: "Will this study's startup hit its milestone?",
      yesCriteria: "Resolves YES if the milestone is publicly confirmed before the deadline.",
      noCriteria: "Resolves NO if the milestone is not confirmed by the deadline.",
      deadline: new Date(Date.now() + 60 * DAY),
      status: opts.status ?? StudyStatus.APPROVED,
      participants: { create: (opts.participants ?? []).map((p) => ({ userId: p.id, addedById: author.id })) },
    },
  });
}

function studyMarketInput(study: Awaited<ReturnType<typeof makeStudy>>, visibility: "PUBLIC" | "ORGANIZATION" | "RESTRICTED") {
  return {
    studyId: study.id,
    organizationId: study.organizationId,
    startupId: study.startupId,
    question: study.question,
    yesCriteria: study.yesCriteria,
    noCriteria: study.noCriteria,
    closesAt: study.deadline,
    openingBaseline: { value: 0.3, methodology: "Base rate" },
    visibility,
    sources: [{ url: "https://example.com/filing", title: "Filing" }],
    createdById: study.createdById,
  };
}

describe("market visibility and organization isolation", () => {
  it("shows organization markets only to that org's members", async () => {
    const admin = await makeAdmin();
    const alice = await makeUser();
    const bob = await makeUser();
    const orgA = await makeOrg([[alice, OrgRole.VIEWER]]);
    await makeOrg([[bob, OrgRole.OWNER]]);
    const market = await makeMarket(admin, { private: orgA.id });

    expect(await canViewMarket(alice.id, market.id)).toBe(true);
    expect(await canViewMarket(bob.id, market.id)).toBe(false);
    expect(await canViewMarket(null, market.id)).toBe(false);
    await expect(requireOrgRole(bob, orgA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("does not show org markets to platform admins who aren't members", async () => {
    const admin = await makeAdmin();
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    const market = await makeMarket(admin, { private: org.id });
    expect(await canViewMarket(admin.id, market.id)).toBe(false);
  });

  it("limits restricted study markets to org admins, the author, and participants", async () => {
    const owner = await makeUser();
    const author = await makeUser();
    const analyst = await makeUser();
    const outsider = await makeUser();
    const org = await makeOrg([
      [owner, OrgRole.OWNER],
      [author, OrgRole.ANALYST],
      [analyst, OrgRole.ANALYST],
    ]);
    const study = await makeStudy(org.id, author, { participants: [outsider] });
    const market = await createMarketForStudy(studyMarketInput(study, "RESTRICTED"));
    // VC Intelligence links the study to its market when the open transition commits.
    await db.researchStudy.update({ where: { id: study.id }, data: { marketId: market.id, status: StudyStatus.OPEN } });

    expect(await canViewMarket(owner.id, market.id)).toBe(true);
    expect(await canViewMarket(author.id, market.id)).toBe(true);
    expect(await canViewMarket(outsider.id, market.id)).toBe(true);
    expect(await canViewMarket(analyst.id, market.id)).toBe(false);
    expect(await db.market.count({ where: visibleMarketsWhere(analyst.id) })).toBe(0);
  });
});

describe("createMarketForStudy", () => {
  it("opens one market per study, even when called repeatedly or concurrently", async () => {
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    const study = await makeStudy(org.id, owner);
    const input = studyMarketInput(study, "ORGANIZATION");

    const results = await Promise.all([1, 2, 3].map(() => createMarketForStudy(input)));
    expect(new Set(results.map((m) => m.id)).size).toBe(1);
    expect(results[0]).toMatchObject({ status: "OPEN", visibility: "ORGANIZATION", organizationId: org.id, openingBaseline: 0.3 });
    expect(await db.marketSource.count({ where: { marketId: results[0]!.id } })).toBe(1);
    expect(await db.marketSnapshot.count({ where: { marketId: results[0]!.id, trigger: "OPENING" } })).toBe(1);
  });

  it("closes a study's market once, and ignores studies without one", async () => {
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    const study = await makeStudy(org.id, owner);
    expect(await closeMarketForStudy({ studyId: study.id, closedById: owner.id })).toBeNull();

    const market = await createMarketForStudy(studyMarketInput(study, "ORGANIZATION"));
    await db.researchStudy.update({ where: { id: study.id }, data: { marketId: market.id, status: StudyStatus.OPEN } });

    const [first, second] = await Promise.all([
      closeMarketForStudy({ studyId: study.id, closedById: owner.id, reason: "Closed early" }),
      closeMarketForStudy({ studyId: study.id, closedById: owner.id }),
    ]);
    expect(first?.status).toBe("CLOSED");
    expect(second?.status).toBe("CLOSED");
    expect(await db.auditLog.count({ where: { action: "market.closeFromStudy", entityId: market.id } })).toBe(1);
  });

  it("refuses studies that haven't been approved", async () => {
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    const study = await makeStudy(org.id, owner, { status: StudyStatus.SUBMITTED });
    await expect(createMarketForStudy(studyMarketInput(study, "PUBLIC"))).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("refuses details that don't match the study", async () => {
    const owner = await makeUser();
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    const other = await makeOrg([[owner, OrgRole.OWNER]]);
    const study = await makeStudy(org.id, owner);
    await expect(
      createMarketForStudy({ ...studyMarketInput(study, "PUBLIC"), organizationId: other.id }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
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

  it("removes study invitations along with org membership", async () => {
    const owner = await makeUser();
    const analyst = await makeUser();
    const org = await makeOrg([
      [owner, OrgRole.OWNER],
      [analyst, OrgRole.ANALYST],
    ]);
    const study = await makeStudy(org.id, owner, { participants: [analyst] });
    await removeMember(owner, org.id, analyst.id);
    expect(await db.studyParticipant.count({ where: { studyId: study.id } })).toBe(0);
  });
});
