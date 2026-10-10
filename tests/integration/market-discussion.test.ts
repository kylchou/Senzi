import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ProductVerificationMethod, VerificationStatus } from "@/generated/prisma/enums";
import { ApiError } from "@/lib/api-response";
import { db } from "@/lib/db";
import { createComment, findDiscussionMarket, listComments, removeComment } from "@/lib/market-view/discussion";
import { makeAdmin, makeMarket, makeOrg, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

async function expectApiError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((error) => error instanceof ApiError && error.code === code);
}

async function setup() {
  const admin = await makeAdmin();
  const market = await makeMarket(admin);
  const discussion = (await findDiscussionMarket(market.slug))!;
  return { admin, market, discussion };
}

describe("market discussion", () => {
  it("lists newest comments first with replies oldest first, names and pictures only", async () => {
    const { discussion } = await setup();
    const ana = await makeUser({ name: "Ana Costa" });
    const ben = await makeUser({ name: "Ben Lee" });
    const first = await createComment(discussion, ana, { body: "Leaning YES." });
    await createComment(discussion, ben, { body: "Agreed.", parentId: first.id });
    await createComment(discussion, ana, { body: "Second reply.", parentId: first.id });
    await createComment(discussion, ben, { body: "Newest top-level." });

    const page = await listComments(discussion, null, { limit: 20 });
    expect(page.total).toBe(4);
    expect(page.comments.map((c) => c.body)).toEqual(["Newest top-level.", "Leaning YES."]);
    expect(page.comments[1]!.replies.map((r) => r.body)).toEqual(["Agreed.", "Second reply."]);
    expect(page.comments[1]!.author).toEqual({ id: ana.id, name: "Ana Costa", username: null, avatarUrl: null, verified: false });
    expect(JSON.stringify(page)).not.toContain("@test.senzi.invalid");
    expect(page.posting).toBe("signed-out");
  });

  it("pages through top-level comments with a cursor", async () => {
    const { discussion } = await setup();
    const user = await makeUser();
    for (let i = 0; i < 5; i++) await createComment(discussion, user, { body: `Comment ${i}` });
    const first = await listComments(discussion, user, { limit: 2 });
    expect(first.comments).toHaveLength(2);
    const second = await listComments(discussion, user, { limit: 2, cursor: first.nextCursor! });
    const third = await listComments(discussion, user, { limit: 2, cursor: second.nextCursor! });
    const seen = [...first.comments, ...second.comments, ...third.comments].map((c) => c.body);
    expect(new Set(seen).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it("marks verified product users", async () => {
    const { market, discussion } = await setup();
    const user = await makeUser();
    await db.productUserVerification.create({
      data: { userId: user.id, startupId: market.startupId, method: ProductVerificationMethod.ACCESS_CODE, status: VerificationStatus.APPROVED },
    });
    const comment = await createComment(discussion, user, { body: "I use it." });
    expect(comment.author?.verified).toBe(true);
  });

  it("needs a finished account to post and only allows one level of replies", async () => {
    const { discussion } = await setup();
    const unfinished = await makeUser({ accountType: null });
    await expectApiError(createComment(discussion, unfinished, { body: "Hi" }), "FORBIDDEN");

    const user = await makeUser();
    const top = await createComment(discussion, user, { body: "Top" });
    const reply = await createComment(discussion, user, { body: "Reply", parentId: top.id });
    await expectApiError(createComment(discussion, user, { body: "Nested", parentId: reply.id }), "INVALID_STATE");
  });

  it("rejects replies to comments on other markets", async () => {
    const { admin, discussion } = await setup();
    const other = (await findDiscussionMarket((await makeMarket(admin)).slug))!;
    const user = await makeUser();
    const elsewhere = await createComment(other, user, { body: "Other market" });
    await expectApiError(createComment(discussion, user, { body: "Sneaky", parentId: elsewhere.id }), "NOT_FOUND");
  });

  it("lets authors and admins remove comments, keeping threads intact", async () => {
    const { discussion } = await setup();
    const author = await makeUser();
    const stranger = await makeUser();
    const admin = await makeAdmin();
    const top = await createComment(discussion, author, { body: "Will be removed" });
    await createComment(discussion, stranger, { body: "A reply", parentId: top.id });
    const lone = await createComment(discussion, author, { body: "Lone comment" });

    await expectApiError(removeComment(discussion, stranger, top.id), "FORBIDDEN");
    await removeComment(discussion, author, top.id);
    await removeComment(discussion, admin, lone.id);

    const page = await listComments(discussion, stranger, { limit: 20 });
    // The removed comment with a reply stays as a placeholder; the lone one disappears.
    expect(page.comments).toHaveLength(1);
    expect(page.comments[0]).toMatchObject({ removed: true, body: null, author: null });
    expect(page.comments[0]!.replies.map((r) => r.body)).toEqual(["A reply"]);
    expect(page.total).toBe(1);

    const stored = await db.marketComment.findUniqueOrThrow({ where: { id: top.id } });
    expect(stored.body).toBe("");
    const audits = await db.auditLog.findMany({ where: { action: "market_comment.remove" } });
    expect(audits.map((a) => a.entityId)).toEqual([lone.id]);
  });

  it("hides private markets and enforces the length limit in the database", async () => {
    const admin = await makeAdmin();
    const org = await makeOrg([[admin, "OWNER"]]);
    const hidden = await makeMarket(admin, { private: org.id });
    expect(await findDiscussionMarket(hidden.slug)).toBeNull();

    const { discussion } = await setup();
    const user = await makeUser();
    await expect(
      db.marketComment.create({ data: { marketId: discussion.id, userId: user.id, body: "x".repeat(1001) } }),
    ).rejects.toThrow();
    await expect(db.marketComment.create({ data: { marketId: discussion.id, userId: user.id, body: "   " } })).rejects.toThrow();
  });
});
