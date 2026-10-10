import { describe, expect, it } from "vitest";
import { parseNewsParams } from "@/lib/discovery/params";
import { newsFilter, publicNewsWhere } from "@/lib/news/queries";

describe("parseNewsParams", () => {
  it("accepts known filters and drops the rest", () => {
    expect(parseNewsParams({ verification: "verified", industry: "Climate" })).toMatchObject({
      verification: "verified",
      industry: "Climate",
    });
    expect(parseNewsParams({ verification: "everything" }).verification).toBeUndefined();
  });
});

describe("newsFilter", () => {
  it("always keeps the public news scope", () => {
    expect(newsFilter({ verification: undefined, industry: undefined }).AND).toEqual([publicNewsWhere]);
  });

  it("splits verified from reported, where reported covers unverified and disputed", () => {
    expect(newsFilter({ verification: "verified", industry: undefined }).AND).toContainEqual({ verification: "VERIFIED" });
    expect(newsFilter({ verification: "reported", industry: undefined }).AND).toContainEqual({
      verification: { not: "VERIFIED" },
    });
  });

  it("filters by the startup industry", () => {
    expect(newsFilter({ verification: undefined, industry: "AI" }).AND).toContainEqual({ startup: { industry: "AI" } });
  });
});
