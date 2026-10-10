import { describe, expect, it } from "vitest";
import {
  marketQuerySchema,
  PAGE_SIZE,
  parseMarketParams,
  parseSearchQuery,
  parseStartupParams,
  startupQuerySchema,
  toQueryString,
} from "@/lib/discovery/params";

describe("parseMarketParams", () => {
  it("returns defaults for empty input", () => {
    expect(parseMarketParams({})).toEqual({
      q: undefined,
      status: undefined,
      sector: undefined,
      sort: "closing",
      cursor: undefined,
      limit: PAGE_SIZE,
    });
  });

  it("accepts valid filters", () => {
    const params = parseMarketParams({ q: "  series b ", status: "RESOLVED", sector: "Fintech", sort: "active", cursor: "abc" });
    expect(params).toMatchObject({ q: "series b", status: "RESOLVED", sector: "Fintech", sort: "active", cursor: "abc" });
  });

  it("falls back on invalid values instead of throwing", () => {
    const params = parseMarketParams({ status: "PRIVATE", sort: "random", cursor: "x".repeat(200) });
    expect(params.status).toBeUndefined();
    expect(params.sort).toBe("closing");
    expect(params.cursor).toBeUndefined();
  });

  it("never allows the DRAFT status through", () => {
    expect(parseMarketParams({ status: "DRAFT" }).status).toBeUndefined();
  });

  it("reads the first value of repeated params and URLSearchParams", () => {
    expect(parseMarketParams({ q: ["one", "two"] }).q).toBe("one");
    expect(parseMarketParams(new URLSearchParams("sector=AI")).sector).toBe("AI");
  });
});

describe("marketQuerySchema (API)", () => {
  it("applies the API default limit", () => {
    expect(marketQuerySchema.parse({}).limit).toBe(20);
  });

  it("rejects invalid values so the API can answer 400", () => {
    expect(marketQuerySchema.safeParse({ status: "DRAFT" }).success).toBe(false);
    expect(marketQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(marketQuerySchema.safeParse({ sort: "random" }).success).toBe(false);
  });
});

describe("startup params", () => {
  it("parses query and sector", () => {
    expect(parseStartupParams({ q: "robot", sector: "Hardware" })).toMatchObject({ q: "robot", sector: "Hardware" });
    expect(startupQuerySchema.parse({ limit: "5" }).limit).toBe(5);
  });
});

describe("parseSearchQuery", () => {
  it("trims and drops empty queries", () => {
    expect(parseSearchQuery({ q: "   " })).toBeUndefined();
    expect(parseSearchQuery({ q: " acme " })).toBe("acme");
    expect(parseSearchQuery({ q: "x".repeat(200) })).toBeUndefined();
  });
});

describe("toQueryString", () => {
  it("drops empty values", () => {
    expect(toQueryString({ q: "ai", status: undefined, sector: "" })).toBe("?q=ai");
    expect(toQueryString({ cursor: "c1" })).toBe("?cursor=c1");
    expect(toQueryString({})).toBe("");
  });
});
