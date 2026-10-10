import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { OrgRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addMember, createOrganization } from "@/lib/organizations";
import {
  emailMatchesWebsite,
  latestVcVerification,
  reviewVcVerification,
  submitVcVerification,
  switchToTrader,
} from "@/lib/verification";
import { makeAdmin, makeOrg, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const details = {
  firmName: "Northwind Capital",
  firmWebsite: "https://www.northwind.vc",
  jobTitle: "Associate",
  workEmail: "sam@northwind.vc",
  linkedinUrl: null,
  note: null,
};

const unverifiedVc = () => makeUser({ accountType: "VC", verified: false });

describe("VC verification", () => {
  it("approves a VC after review, with a notification and an audit entry", async () => {
    const admin = await makeAdmin();
    const vc = await unverifiedVc();
    const request = await submitVcVerification(vc, details);
    await expect(submitVcVerification(vc, details)).rejects.toMatchObject({ code: "CONFLICT" });

    await reviewVcVerification(admin, request.id, { decision: "APPROVED", note: null });
    expect((await db.user.findUniqueOrThrow({ where: { id: vc.id } })).accountVerifiedAt).not.toBeNull();
    expect(await db.notification.count({ where: { userId: vc.id, title: "Your VC account is verified" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "verification.review", entityId: request.id } })).toBe(1);
    await expect(reviewVcVerification(admin, request.id, { decision: "REJECTED", note: "Too late" })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  it("lets a rejected VC fix their details and try again", async () => {
    const admin = await makeAdmin();
    const vc = await unverifiedVc();
    const first = await submitVcVerification(vc, details);
    await reviewVcVerification(admin, first.id, { decision: "REJECTED", note: "Use your work email" });
    expect((await db.user.findUniqueOrThrow({ where: { id: vc.id } })).accountVerifiedAt).toBeNull();
    expect((await latestVcVerification(vc.id))?.reviewNote).toBe("Use your work email");
    await submitVcVerification(vc, { ...details, workEmail: "sam.lee@northwind.vc" });
    expect((await latestVcVerification(vc.id))?.status).toBe("PENDING");
  });

  it("only takes requests from unverified VCs, and admins can't review their own", async () => {
    const trader = await makeUser();
    await expect(submitVcVerification(trader, details)).rejects.toMatchObject({ code: "INVALID_STATE" });
    const verified = await makeUser({ accountType: "VC" });
    await expect(submitVcVerification(verified, details)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const admin = await makeUser({ admin: true, accountType: "VC", verified: false });
    const own = await submitVcVerification(admin, details);
    await expect(reviewVcVerification(admin, own.id, { decision: "APPROVED", note: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const user = await unverifiedVc();
    const other = await submitVcVerification(user, details);
    await expect(reviewVcVerification(user, other.id, { decision: "APPROVED", note: null })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("verifies VCs a firm invites", async () => {
    const owner = await makeUser({ accountType: "VC" });
    const org = await makeOrg([[owner, OrgRole.OWNER]]);
    const vc = await unverifiedVc();
    await addMember(owner, org.id, { email: vc.email, role: OrgRole.ANALYST });
    expect((await db.user.findUniqueOrThrow({ where: { id: vc.id } })).accountVerifiedAt).not.toBeNull();
  });

  it("only lets verified VCs (or admins) create organizations", async () => {
    const input = { name: "New Fund", slug: "new-fund" };
    await expect(createOrganization(await unverifiedVc(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createOrganization(await makeUser(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createOrganization(await makeUser({ accountType: "VC" }), input)).resolves.toMatchObject({ slug: "new-fund" });
  });

  it("lets an unverified VC switch to trading, and withdraws their request", async () => {
    const vc = await unverifiedVc();
    await submitVcVerification(vc, details);
    await switchToTrader(vc);
    const after = await db.user.findUniqueOrThrow({ where: { id: vc.id } });
    expect(after).toMatchObject({ accountType: "TRADER" });
    expect(after.accountVerifiedAt).not.toBeNull();
    expect((await latestVcVerification(vc.id))?.status).toBe("REJECTED");
    await expect(switchToTrader(await makeUser({ accountType: "VC" }))).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("flags work emails off the firm's domain", () => {
    expect(emailMatchesWebsite("sam@northwind.vc", "https://www.northwind.vc")).toBe(true);
    expect(emailMatchesWebsite("sam@mail.northwind.vc", "https://northwind.vc/team")).toBe(true);
    expect(emailMatchesWebsite("sam@gmail.com", "https://northwind.vc")).toBe(false);
    expect(emailMatchesWebsite("sam@northwind.vc", "not a url")).toBe(false);
  });
});
