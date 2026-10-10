import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createNewsItem,
  createStartupFact,
  deleteStartupFact,
  listAdminNews,
  updateNewsItem,
  updateStartupFact,
} from "@/lib/admin-content";
import { db } from "@/lib/db";
import { newsItemSchema, startupFactSchema } from "@/lib/validation";
import { makeAdmin, makeStartup, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const fact = startupFactSchema.parse({
  label: "Total funding",
  value: "$12M",
  sourceName: "Company press release",
  sourceUrl: "https://example.com/press",
  asOf: "2026-09-01T00:00:00Z",
});

const article = (startupId: string) =>
  newsItemSchema.parse({
    startupId,
    title: "Startup raises a seed round",
    publisher: "Demo Daily",
    url: "https://news.example.com/seed",
    publishedAt: "2026-09-15T12:00:00Z",
  });

describe("startup facts", () => {
  it("starts unverified and audits who verified it", async () => {
    const admin = await makeAdmin();
    const startup = await makeStartup();
    const created = await createStartupFact(admin, startup.id, fact);
    expect(created.verified).toBe(false);

    await updateStartupFact(admin, created.id, { verified: true });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "startupFact.verify", entityId: created.id } });
    expect(audit.actorId).toBe(admin.id);
    expect(audit.data).toMatchObject({ verified: { from: false, to: true } });
  });

  it("keeps a record of deleted facts in the audit log", async () => {
    const admin = await makeAdmin();
    const startup = await makeStartup();
    const created = await createStartupFact(admin, startup.id, fact);
    await deleteStartupFact(admin, created.id);
    expect(await db.startupFact.count()).toBe(0);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "startupFact.delete" } });
    expect(audit.data).toMatchObject({ label: "Total funding", value: "$12M" });
  });

  it("is admin-only", async () => {
    const user = await makeUser();
    const startup = await makeStartup();
    await expect(createStartupFact(user, startup.id, fact)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects facts for missing startups", async () => {
    const admin = await makeAdmin();
    await expect(createStartupFact(admin, "missing", fact)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("news", () => {
  it("creates unverified articles and records verification changes", async () => {
    const admin = await makeAdmin();
    const startup = await makeStartup();
    const item = await createNewsItem(admin, article(startup.id));
    expect(item.verification).toBe("UNVERIFIED");

    await updateNewsItem(admin, item.id, { verification: "DISPUTED" });
    expect(await db.auditLog.count({ where: { action: "news.verify", entityId: item.id } })).toBe(1);
    expect(await listAdminNews(admin, { verification: "DISPUTED" })).toHaveLength(1);
  });

  it("is admin-only", async () => {
    const user = await makeUser();
    const startup = await makeStartup();
    await expect(createNewsItem(user, article(startup.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("content validation", () => {
  it("only accepts http(s) source links", () => {
    expect(startupFactSchema.safeParse({ ...fact, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(newsItemSchema.safeParse({ ...article("s1"), url: "data:text/html,hi" }).success).toBe(false);
  });
});
