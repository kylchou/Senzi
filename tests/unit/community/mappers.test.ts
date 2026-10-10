import { describe, expect, it } from "vitest";
import { allocationShare, cleanShare, toMarketDetail, toMarketSummary, toNewsItem } from "@/lib/market-view/mappers";
import { marketOrder, publicMarketFilter } from "@/lib/market-view/queries";
import { publicNewsWhere } from "@/lib/news/queries";
import { publicStartupFilter } from "@/lib/discovery/queries";
import { PUBLIC_MARKET_WHERE, PUBLIC_STARTUP_WHERE } from "@/lib/permissions";

const summaryRow = {
  id: "m1",
  slug: "acme-series-b",
  question: "Will Acme announce a Series B by June 30?",
  status: "OPEN" as const,
  closesAt: new Date("2027-06-30T00:00:00Z"),
  openingBaseline: 0.35,
  yesCredits: 600,
  noCredits: 400,
  forecastCount: 14,
  startup: { slug: "acme", name: "Acme", industry: "Fintech", logoUrl: null },
  snapshots: [{ calibratedProbability: 0.52, forecasterCount: 12, recordedAt: new Date("2026-10-09T00:00:00Z") }],
  resolution: null,
};

const newsRow = {
  id: "n1",
  title: "Acme hires a CFO",
  url: "https://example.com/acme",
  publisher: "Example Wire",
  publishedAt: new Date("2026-10-01T00:00:00Z"),
  summary: null,
  verification: "VERIFIED" as const,
  startup: { slug: "acme", name: "Acme", isPublished: true },
};

const detailRow = {
  ...summaryRow,
  description: null,
  yesCriteria: "Announced on the company blog.",
  noCriteria: "No announcement by the deadline.",
  baselineMethodology: "Base rate of comparable rounds.",
  category: null,
  opensAt: new Date("2026-09-01T00:00:00Z"),
  resolvesBy: null,
  startup: { ...summaryRow.startup, tagline: "Payments", websiteUrl: null },
  resolution: null,
  sources: [{ title: "Company blog", url: "https://example.com/blog", publisher: null, publishedAt: null }],
  news: [newsRow],
};

describe("allocation share", () => {
  it("is YES credits over all credits", () => {
    expect(allocationShare(600, 400)).toBe(0.6);
    expect(allocationShare(0, 50)).toBe(0);
  });

  it("is null for an empty market", () => {
    expect(allocationShare(0, 0)).toBeNull();
  });
});

describe("cleanShare", () => {
  it("keeps values in [0, 1] and drops anything else", () => {
    expect(cleanShare(0.42)).toBe(0.42);
    expect(cleanShare(-0.1)).toBeNull();
    expect(cleanShare(1.2)).toBeNull();
    expect(cleanShare(Number.NaN)).toBeNull();
    expect(cleanShare(null)).toBeNull();
  });
});

describe("toMarketSummary", () => {
  it("keeps baseline, allocation share, and calibrated probability separate", () => {
    const summary = toMarketSummary(summaryRow);
    expect(summary.openingBaseline).toBe(0.35);
    expect(summary.allocation.share).toBe(0.6);
    expect(summary.calibratedProbability).toBe(0.52);
    expect(summary.forecasterCount).toBe(12);
    expect(summary.allocation.forecastCount).toBe(14);
  });

  it("handles markets without snapshots or credits", () => {
    const summary = toMarketSummary({ ...summaryRow, yesCredits: 0, noCredits: 0, snapshots: [] });
    expect(summary.allocation.share).toBeNull();
    expect(summary.calibratedProbability).toBeNull();
    expect(summary.updatedAt).toBeNull();
  });

  it("reports the outcome only when a resolution exists", () => {
    expect(toMarketSummary(summaryRow).outcome).toBeNull();
    const resolved = toMarketSummary({
      ...summaryRow,
      status: "RESOLVED",
      resolution: { outcome: "NO" as const, resolvedAt: new Date("2026-10-08T00:00:00Z") },
    });
    expect(resolved.outcome).toBe("NO");
    expect(resolved.resolvedAt).toBe("2026-10-08T00:00:00.000Z");
  });
});

describe("toMarketDetail", () => {
  it("maps YES and NO criteria, sources, methodology, and linked coverage", () => {
    const detail = toMarketDetail(detailRow);
    expect(detail.yesCriteria).toBe("Announced on the company blog.");
    expect(detail.noCriteria).toBe("No announcement by the deadline.");
    expect(detail.baselineMethodology).toBe("Base rate of comparable rounds.");
    expect(detail.sources).toEqual([{ title: "Company blog", url: "https://example.com/blog", publisher: null, publishedAt: null }]);
    expect(detail.coverage).toHaveLength(1);
    expect(detail.resolution).toBeNull();
  });

  it("keeps a missing baseline as null", () => {
    expect(toMarketDetail({ ...detailRow, openingBaseline: null }).openingBaseline).toBeNull();
  });
});

describe("toNewsItem", () => {
  it("keeps the verification label", () => {
    expect(toNewsItem(newsRow)).toMatchObject({ publisher: "Example Wire", verification: "VERIFIED", url: "https://example.com/acme" });
  });

  it("drops the link to an unpublished startup", () => {
    expect(toNewsItem({ ...newsRow, startup: { slug: "secret", name: "Secret", isPublished: false } }).startup).toBeNull();
  });
});

describe("public filters", () => {
  it("always include the shared public market filter", () => {
    const where = publicMarketFilter({ q: "acme", status: "OPEN", industry: "AI" });
    expect(where.AND).toContain(PUBLIC_MARKET_WHERE);
    expect(publicMarketFilter({ q: undefined, status: undefined, industry: undefined }).AND).toEqual([PUBLIC_MARKET_WHERE]);
  });

  it("always include the shared public startup filter", () => {
    expect(publicStartupFilter({ q: "robot", industry: undefined }).AND).toContain(PUBLIC_STARTUP_WHERE);
  });

  it("keep news tied to private markets or unpublished startups out", () => {
    expect(publicNewsWhere.AND).toEqual([
      { OR: [{ startupId: null }, { startup: PUBLIC_STARTUP_WHERE }] },
      { OR: [{ marketId: null }, { market: PUBLIC_MARKET_WHERE }] },
    ]);
  });

  it("order every sort by id last for stable cursors", () => {
    for (const sort of ["closing", "active", "newest"] as const) {
      expect(marketOrder(sort).at(-1)).toEqual({ id: "asc" });
    }
  });
});
