import { describe, expect, it } from "vitest";
import { generateCode, hashCode, normalizeCode, screenshotType } from "@/lib/product-proof";
import { defaultConfig } from "@/lib/forecasting/config";
import { checkEligibility } from "@/lib/forecasting/eligibility";
import type { Market } from "@/lib/forecasting/types";

describe("access codes", () => {
  it("ignore case, spaces, and dashes", () => {
    expect(normalizeCode(" stripe-demo ")).toBe("STRIPEDEMO");
    expect(hashCode("Stripe Demo")).toBe(hashCode("STRIPE-DEMO"));
    expect(hashCode("STRIPE-DEMO")).not.toBe(hashCode("STRIPE-DEMO-2"));
  });

  it("are generated with a readable prefix and no look-alike characters", () => {
    const code = generateCode("stripe");
    expect(code).toMatch(/^STRIPE-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(new Set(Array.from({ length: 50 }, () => generateCode("x"))).size).toBe(50);
  });
});

describe("screenshot type", () => {
  it("reads the file's first bytes", () => {
    expect(screenshotType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe("image/png");
    expect(screenshotType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(screenshotType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(screenshotType(new TextEncoder().encode("<svg></svg>"))).toBeNull();
  });
});

describe("eligibility on verified-users markets", () => {
  const market = { id: "m", companyId: "stripe", sponsorId: "admin", verifiedUsersOnly: true } as Market;
  const traders = (verified: boolean) => ({ isVerifiedUserOf: async () => verified, hasConflictOfInterest: async () => false });

  it("needs a verified user", async () => {
    expect(await checkEligibility(market, "u", traders(false), defaultConfig)).toMatchObject({ eligible: false, reason: "NOT_VERIFIED" });
    expect(await checkEligibility(market, "u", traders(true), defaultConfig)).toMatchObject({ eligible: true, verified: true });
  });

  it("leaves ordinary markets open to everyone", async () => {
    const open = { ...market, verifiedUsersOnly: false };
    expect(await checkEligibility(open, "u", traders(false), defaultConfig)).toMatchObject({ eligible: true, verified: false });
  });
});
