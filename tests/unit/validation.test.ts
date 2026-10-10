import { describe, expect, it } from "vitest";
import {
  adminCreditAdjustmentSchema,
  createMarketForStudySchema,
  createMarketSchema,
  forecastSubmissionSchema,
  httpUrlSchema,
  proposeCorrectionSchema,
  proposeResolutionSchema,
  resolveMarketSchema,
  updateProfileSchema,
} from "@/lib/validation";

const validMarket = {
  slug: "acme-series-b",
  startupId: "startup_1",
  question: "Will Acme raise a Series B by 2027?",
  yesCriteria: "YES if Acme announces a priced Series B before 2027-12-31.",
  noCriteria: "NO if no priced Series B is announced by 2027-12-31.",
  openingBaseline: 0.4,
  baselineMethodology: "Base rate for Series A companies",
  opensAt: "2026-10-01T00:00:00Z",
  closesAt: "2027-06-30T00:00:00Z",
  sources: [{ title: "Acme newsroom", url: "https://acme.example.com/news" }],
};

describe("createMarketSchema", () => {
  it("accepts a well-formed market and parses dates", () => {
    const market = createMarketSchema.parse(validMarket);
    expect(market.closesAt).toBeInstanceOf(Date);
    expect(market.visibility).toBe("PUBLIC");
    expect(market.openImmediately).toBe(false);
  });

  it("requires the deadline to come after the open time", () => {
    const result = createMarketSchema.safeParse({ ...validMarket, closesAt: "2026-09-01T00:00:00Z" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["closesAt"]);
  });

  it("requires non-public markets to name an organization", () => {
    expect(createMarketSchema.safeParse({ ...validMarket, visibility: "RESTRICTED" }).success).toBe(false);
    expect(
      createMarketSchema.safeParse({ ...validMarket, visibility: "ORGANIZATION", organizationId: "org_1" }).success,
    ).toBe(true);
  });

  it("needs a methodology whenever there is a baseline", () => {
    expect(createMarketSchema.safeParse({ ...validMarket, baselineMethodology: "" }).success).toBe(false);
    const noBaseline = { ...validMarket, openingBaseline: undefined, baselineMethodology: undefined };
    expect(createMarketSchema.safeParse(noBaseline).success).toBe(true);
  });

  it("needs at least one resolution source and both criteria", () => {
    expect(createMarketSchema.safeParse({ ...validMarket, sources: [] }).success).toBe(false);
    expect(createMarketSchema.safeParse({ ...validMarket, noCriteria: undefined }).success).toBe(false);
  });

  it("keeps the opening baseline away from 0 and 1", () => {
    expect(createMarketSchema.safeParse({ ...validMarket, openingBaseline: 0 }).success).toBe(false);
    expect(createMarketSchema.safeParse({ ...validMarket, openingBaseline: 1 }).success).toBe(false);
  });

  it("wants a YES/NO question", () => {
    expect(createMarketSchema.safeParse({ ...validMarket, question: "Acme raises a Series B" }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(createMarketSchema.safeParse({ ...validMarket, yesCredits: 1000 }).success).toBe(false);
  });
});

describe("createMarketForStudySchema", () => {
  it("accepts the VC Intelligence payload", () => {
    const result = createMarketForStudySchema.safeParse({
      studyId: "study_1",
      organizationId: "org_1",
      startupId: "startup_1",
      question: "Will Acme raise a Series B by 2027?",
      yesCriteria: "YES if Acme announces a priced Series B before 2027-12-31.",
      noCriteria: "NO if no priced Series B is announced by 2027-12-31.",
      closesAt: new Date("2027-06-30T00:00:00Z"),
      openingBaseline: { value: 0.3, methodology: "Base rate" },
      visibility: "RESTRICTED",
      sources: [],
      createdById: "user_1",
    });
    expect(result.success).toBe(true);
  });
});

describe("resolveMarketSchema", () => {
  it("requires at least one http(s) evidence link", () => {
    const base = { outcome: "YES", evidenceSummary: "Press release confirms the round closed in time." };
    expect(resolveMarketSchema.safeParse({ ...base, evidenceUrls: [] }).success).toBe(false);
    expect(resolveMarketSchema.safeParse({ ...base, evidenceUrls: ["javascript:alert(1)"] }).success).toBe(false);
    expect(resolveMarketSchema.safeParse({ ...base, evidenceUrls: ["https://example.com/pr"] }).success).toBe(true);
  });
});

describe("adminCreditAdjustmentSchema", () => {
  const base = { userId: "u1", type: "ADMIN_GRANT", memo: "Contest prize", idempotencyKey: "grant-0001" };

  it("only allows positive grants", () => {
    expect(adminCreditAdjustmentSchema.safeParse({ ...base, amount: -50 }).success).toBe(false);
    expect(adminCreditAdjustmentSchema.safeParse({ ...base, amount: 50 }).success).toBe(true);
  });

  it("allows negative corrections but never zero or fractions", () => {
    const correction = { ...base, type: "ADMIN_ADJUSTMENT" };
    expect(adminCreditAdjustmentSchema.safeParse({ ...correction, amount: -50 }).success).toBe(true);
    expect(adminCreditAdjustmentSchema.safeParse({ ...correction, amount: 0 }).success).toBe(false);
    expect(adminCreditAdjustmentSchema.safeParse({ ...correction, amount: 1.5 }).success).toBe(false);
  });
});

describe("forecastSubmissionSchema", () => {
  it("takes whole positive credits and an optional probability", () => {
    const base = { marketId: "m1", side: "YES", idempotencyKey: "client-key-1" };
    expect(forecastSubmissionSchema.safeParse({ ...base, credits: 100, statedProbability: 0.7 }).success).toBe(true);
    expect(forecastSubmissionSchema.safeParse({ ...base, credits: 0 }).success).toBe(false);
    expect(forecastSubmissionSchema.safeParse({ ...base, credits: 10.5 }).success).toBe(false);
    expect(forecastSubmissionSchema.safeParse({ ...base, credits: 10, statedProbability: 1.2 }).success).toBe(false);
  });
});

describe("profiles and urls", () => {
  it("normalizes usernames and blocks reserved ones", () => {
    expect(updateProfileSchema.parse({ username: "Kyler_C" }).username).toBe("kyler_c");
    expect(updateProfileSchema.safeParse({ username: "me" }).success).toBe(false);
  });

  it("turns empty optional fields into null", () => {
    expect(updateProfileSchema.parse({ bio: "  ", avatarUrl: "" })).toEqual({ bio: null, avatarUrl: null });
  });

  it("only accepts http(s) urls", () => {
    expect(httpUrlSchema.safeParse("https://senzi.example").success).toBe(true);
    expect(httpUrlSchema.safeParse("ftp://senzi.example").success).toBe(false);
    expect(httpUrlSchema.safeParse("data:text/html,hi").success).toBe(false);
  });
});

describe("proposeResolutionSchema", () => {
  const base = {
    evidenceSummary: "The company announced the round in a press release.",
    evidence: [{ title: "Press release", url: "https://example.com/pr" }],
  };

  it("requires a reason for VOID and only for VOID", () => {
    expect(proposeResolutionSchema.safeParse({ ...base, outcome: "VOID" }).success).toBe(false);
    expect(proposeResolutionSchema.safeParse({ ...base, outcome: "VOID", voidReason: "AMBIGUOUS" }).success).toBe(true);
    expect(proposeResolutionSchema.safeParse({ ...base, outcome: "YES", voidReason: "AMBIGUOUS" }).success).toBe(false);
  });

  it("defaults evidence to link-only licensing", () => {
    const parsed = proposeResolutionSchema.parse({ ...base, outcome: "YES" });
    expect(parsed.evidence[0]).toMatchObject({ license: "LINK_ONLY", sourceType: "OTHER" });
  });

  it("needs a reason for corrections", () => {
    expect(proposeCorrectionSchema.safeParse({ ...base, outcome: "NO" }).success).toBe(false);
    expect(proposeCorrectionSchema.safeParse({ ...base, outcome: "NO", correctionReason: "Wrong filing was cited" }).success).toBe(true);
  });
});
