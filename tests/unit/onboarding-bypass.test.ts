import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-response";

// redirect() throws in Next; emulate that so the action stops where Next would.
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
const user = { id: "u1", accountType: "VC", accountVerifiedAt: null };
const requireUser = vi.fn(async () => user);
vi.mock("@/lib/auth", () => ({ requireUser: () => requireUser(), chooseAccountType: vi.fn(), homePathFor: vi.fn(), parseAccountType: vi.fn() }));
const rateLimit = vi.fn<(...args: unknown[]) => Promise<{ remaining: number }>>(async () => ({ remaining: 1 }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), rateLimit: (...a: unknown[]) => rateLimit(...a) }));
const bypass = vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
vi.mock("@/lib/verification", () => ({ bypassVcVerification: (...a: unknown[]) => bypass(...a), submitVcVerification: vi.fn(), switchToTrader: vi.fn() }));

const { bypassVerificationAction } = await import("@/app/onboarding/actions");

/** Runs the action and returns where it redirected. Fails if it throws anything but a redirect. */
async function submit(code: string) {
  const fd = new FormData();
  fd.set("code", code);
  try {
    await bypassVerificationAction(fd);
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.stubEnv("DEMO_VC_BYPASS_CODE", "senzi-demo");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("bypassVerificationAction", () => {
  it("verifies with the right code, ignoring stray whitespace on either side", async () => {
    vi.stubEnv("DEMO_VC_BYPASS_CODE", "senzi-demo\n");
    expect(await submit("  senzi-demo ")).toBe("/onboarding");
    expect(bypass).toHaveBeenCalledWith(user);
  });

  it("uses its own rate-limit budget, not the firm-details one", async () => {
    await submit("senzi-demo");
    expect(rateLimit.mock.calls[0]![0]).toBe("verification-bypass:u1");
  });

  it("rejects a wrong code without verifying", async () => {
    expect(await submit("nope")).toBe("/onboarding?bypass=invalid");
    expect(bypass).not.toHaveBeenCalled();
  });

  it("is off when the variable is unset", async () => {
    vi.stubEnv("DEMO_VC_BYPASS_CODE", "");
    expect(await submit("")).toBe("/onboarding?bypass=invalid");
    expect(bypass).not.toHaveBeenCalled();
  });

  it("shows a message instead of crashing when rate limited", async () => {
    rateLimit.mockRejectedValueOnce(new ApiError("RATE_LIMITED", "Too many requests. Try again later."));
    expect(await submit("senzi-demo")).toBe("/onboarding?bypass=rate_limited");
  });

  it("shows a message instead of crashing when verification fails", async () => {
    bypass.mockRejectedValueOnce(new Error("db down"));
    expect(await submit("senzi-demo")).toBe("/onboarding?bypass=error");
    expect(console.error).toHaveBeenCalled();
  });
});
