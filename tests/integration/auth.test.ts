import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), currentUser: vi.fn() }));

import { provisionUser, type AuthIdentity } from "@/lib/auth";
import { verifyLedgerIntegrity } from "@/lib/credits";
import { db } from "@/lib/db";
import { PENDING_AUTH_PREFIX, SIGNUP_GRANT_CREDITS } from "@/lib/types";
import { resetDatabase } from "./helpers";

beforeEach(resetDatabase);
afterAll(() => db.$disconnect());

const identity = (overrides: Partial<AuthIdentity> = {}): AuthIdentity => ({
  authId: "user_clerk_123",
  email: "Founder@Example.com",
  emailVerified: true,
  displayName: "Founder",
  avatarUrl: null,
  ...overrides,
});

describe("user provisioning", () => {
  it("creates the user once with a single signup grant, even under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => provisionUser(identity())));
    expect(new Set(results.map((u) => u.id)).size).toBe(1);
    expect(results[0]!.email).toBe("founder@example.com");

    const report = await verifyLedgerIntegrity(results[0]!.id);
    expect(report).toMatchObject({ cachedBalance: SIGNUP_GRANT_CREDITS, ok: true });
  });

  it("claims a pending invite when the email is verified", async () => {
    const pending = await db.user.create({
      data: { authId: `${PENDING_AUTH_PREFIX}founder@example.com`, email: "founder@example.com", displayName: "founder" },
    });
    const user = await provisionUser(identity());
    expect(user.id).toBe(pending.id);
    expect(user.authId).toBe("user_clerk_123");
  });

  it("refuses to claim an invite with an unverified email", async () => {
    await db.user.create({
      data: { authId: `${PENDING_AUTH_PREFIX}founder@example.com`, email: "founder@example.com", displayName: "founder" },
    });
    await expect(provisionUser(identity({ emailVerified: false }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("makes SENZI_ADMIN_EMAILS admins on first sign-in", async () => {
    vi.stubEnv("SENZI_ADMIN_EMAILS", "ops@example.com, founder@example.com");
    const user = await provisionUser(identity());
    expect(user.platformRole).toBe("ADMIN");
    vi.unstubAllEnvs();
  });
});
