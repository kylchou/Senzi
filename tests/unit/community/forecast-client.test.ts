import { afterEach, describe, expect, it, vi } from "vitest";
import { errorMessage, fetchBalance, ForecastError, submitForecast, validateCredits } from "@/lib/market-view/forecast-client";
import { forecastSubmissionSchema } from "@/lib/validation";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const input = { marketId: "m1", side: "YES" as const, credits: 25, idempotencyKey: "0b8f3c2e-7a41-4d55-9e1a-2f6b8c9d0e1f" };
const receipt = {
  id: "r1",
  marketId: "m1",
  side: "YES",
  credits: 25,
  createdAt: "2026-10-09T12:00:00Z",
  entryAllocationShare: 0.6,
  balanceAfter: 975,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("submitForecast", () => {
  it("sends a body that passes the shared forecastSubmissionSchema", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(201, { data: receipt }));
    await expect(submitForecast(input)).resolves.toEqual(receipt);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/forecasts");
    expect(init?.method).toBe("POST");
    expect(forecastSubmissionSchema.safeParse(JSON.parse(init?.body as string)).success).toBe(true);
  });

  it.each([
    [401, { error: { code: "UNAUTHENTICATED", message: "Sign in required" } }, "UNAUTHENTICATED"],
    [401, {}, "UNAUTHENTICATED"],
    [409, { error: { code: "INSUFFICIENT_CREDITS", message: "x" } }, "INSUFFICIENT_CREDITS"],
    [409, { error: { code: "INVALID_STATE", message: "Market is closed" } }, "INVALID_STATE"],
    [409, { error: { code: "CONFLICT", message: "x" } }, "CONFLICT"],
    [404, { error: { code: "NOT_FOUND", message: "Market not found" } }, "NOT_FOUND"],
    [500, { error: { code: "SOMETHING_ELSE", message: "x" } }, "UNKNOWN"],
    [500, "not json", "UNKNOWN"],
  ])("maps HTTP %i to %s", async (status, body, code) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(status, body));
    await expect(submitForecast(input)).rejects.toMatchObject({ code });
  });

  it("reports network failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(submitForecast(input)).rejects.toMatchObject({ code: "NETWORK" });
  });

  it("rejects malformed receipts instead of showing them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(201, { data: { id: "r1" } }));
    await expect(submitForecast(input)).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});

describe("fetchBalance", () => {
  it("reads creditBalance from GET /api/users/me", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json(200, { data: { creditBalance: 1000 } }));
    await expect(fetchBalance()).resolves.toBe(1000);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/users/me");
  });

  it("signals signed-out users", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json(401, { error: { code: "UNAUTHENTICATED", message: "Sign in required" } }));
    await expect(fetchBalance()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });
});

describe("validateCredits", () => {
  it("requires a positive whole number", () => {
    expect(validateCredits("", 100)).toMatch(/Enter/);
    expect(validateCredits("0", 100)).toMatch(/whole number/);
    expect(validateCredits("2.5", 100)).toMatch(/whole number/);
    expect(validateCredits("10", 100)).toBeNull();
  });

  it("flags allocations above the known balance", () => {
    expect(validateCredits("150", 100)).toMatch(/Not enough/);
    expect(validateCredits("150", null)).toBeNull();
  });
});

describe("errorMessage", () => {
  it("gives a specific message per code", () => {
    expect(errorMessage(new ForecastError("UNAUTHENTICATED", ""))).toMatch(/session expired/i);
    expect(errorMessage(new ForecastError("INVALID_STATE", ""))).toMatch(/closed/);
    expect(errorMessage(new ForecastError("VALIDATION_ERROR", "Credits are whole numbers"))).toBe("Credits are whole numbers");
    expect(errorMessage(new ForecastError("INTERNAL_ERROR", "stack trace"))).toBe("Could not submit. Try again.");
  });
});
