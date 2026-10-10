import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, errorResponse, ok, parseJsonBody, toApiError, withApiHandler } from "@/lib/api-response";
import { isBootstrapAdminEmail } from "@/lib/auth";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(), currentUser: vi.fn() }));

describe("api envelope", () => {
  it("wraps data and pagination", async () => {
    const res = ok({ id: "1" }, { nextCursor: null, limit: 20 });
    expect(await res.json()).toEqual({ data: { id: "1" }, meta: { nextCursor: null, limit: 20 } });
  });

  it("turns Zod errors into 400s with field details", async () => {
    const parsed = z.object({ name: z.string() }).safeParse({});
    const res = errorResponse(parsed.error);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details[0].path).toBe("name");
  });

  it("hides unexpected errors behind a generic 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorResponse(new Error("connection string postgres://secret"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("maps thrown ApiErrors through withApiHandler", async () => {
    const handler = withApiHandler(async () => {
      throw new ApiError("FORBIDDEN", "Nope");
    });
    const res = await handler(new Request("http://localhost/api/x"), {});
    expect(res.status).toBe(403);
    expect((await res.json()).error).toEqual({ code: "FORBIDDEN", message: "Nope" });
  });

  it("rejects invalid JSON bodies cleanly", async () => {
    const req = new Request("http://localhost/api/x", { method: "POST", body: "{not json" });
    await expect(parseJsonBody(req, z.object({}))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("passes ApiErrors through untouched", () => {
    const error = new ApiError("INSUFFICIENT_CREDITS", "Not enough");
    expect(toApiError(error)).toBe(error);
    expect(error.status).toBe(409);
  });
});

describe("bootstrap admins", () => {
  it("matches emails case-insensitively from a comma-separated list", () => {
    expect(isBootstrapAdminEmail("Kyler@Example.com", "ops@example.com, kyler@example.com")).toBe(true);
    expect(isBootstrapAdminEmail("someone@example.com", "ops@example.com")).toBe(false);
    expect(isBootstrapAdminEmail("someone@example.com", "")).toBe(false);
  });
});
