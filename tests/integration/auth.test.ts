import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), currentUser: vi.fn() }));

import { chooseAccountType, homePathFor, parseAccountType, provisionUser, type AuthIdentity } from "@/lib/auth";
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
  accountType: null,
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

describe("account types", () => {
  it("takes the type chosen at signup", async () => {
    const trader = await provisionUser(identity({ accountType: "TRADER" }));
    expect(trader.accountType).toBe("TRADER");
    expect(trader.accountVerifiedAt).not.toBeNull();
    // VCs wait for review.
    const vc = await provisionUser(identity({ authId: "user_vc", email: "vc@fund.example", accountType: "VC" }));
    expect(vc.accountVerifiedAt).toBeNull();
  });

  it("keeps a pending invite's VC type, and fills it only when empty", async () => {
    await db.user.create({
      data: { authId: `${PENDING_AUTH_PREFIX}founder@example.com`, email: "founder@example.com", displayName: "founder", accountType: "VC" },
    });
    expect((await provisionUser(identity({ accountType: "TRADER" }))).accountType).toBe("VC");

    await db.user.create({
      data: { authId: `${PENDING_AUTH_PREFIX}other@example.com`, email: "other@example.com", displayName: "other" },
    });
    const other = await provisionUser(identity({ authId: "user_other", email: "other@example.com", accountType: "TRADER" }));
    expect(other.accountType).toBe("TRADER");
  });

  it("lets people choose once", async () => {
    const user = await provisionUser(identity());
    expect(user.accountType).toBeNull();
    expect((await chooseAccountType(user, "VC")).accountType).toBe("VC");
    expect((await chooseAccountType(user, "TRADER")).accountType).toBe("VC");
  });

  it("ignores junk metadata and routes each type home", () => {
    expect(parseAccountType("ADMIN")).toBeNull();
    expect(parseAccountType(undefined)).toBeNull();
    const now = new Date();
    expect(homePathFor({ accountType: "VC", accountVerifiedAt: now })).toBe("/vc");
    expect(homePathFor({ accountType: "VC", accountVerifiedAt: null })).toBe("/onboarding");
    expect(homePathFor({ accountType: "TRADER", accountVerifiedAt: now })).toBe("/profile");
    expect(homePathFor({ accountType: null, accountVerifiedAt: null })).toBe("/onboarding");
  });
});
