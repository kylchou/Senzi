/**
 * INTEGRATION POINT (model indicators).
 *
 * Reads public indicators from the model in lib/model. Today the model keeps
 * its data in files under data/model/; once its data moves into database
 * tables, this file is the one place to switch over.
 *
 * Only scraped public data is used. Sponsor-provided figures are left out on
 * purpose: they can be private to one firm and must never appear in another
 * firm's comparison.
 */
import "server-only";
import { COMPANIES, FileModelStore, getCompanyIndicators } from "@/lib/model";
import type { IndicatorGateway } from "../ports";
import type { CompareIndicators } from "../types";

/** The model's company ids are its own; match a startup by slug, then by name. */
function companyFor(startup: { slug: string; name: string }) {
  const name = startup.name.trim().toLowerCase();
  return COMPANIES.find((c) => c.id === startup.slug) ?? COMPANIES.find((c) => c.name.toLowerCase() === name) ?? null;
}

export function createIndicatorGateway(store = new FileModelStore()): IndicatorGateway {
  return {
    async getIndicators(startup, asOf): Promise<CompareIndicators> {
      const company = companyFor(startup);
      if (!company) return { status: "not_tracked", rows: [] };
      try {
        const scraped = store.readPoints(company.id).filter((p) => p.provenance === "scraped");
        const rows = getCompanyIndicators(company.id, scraped, [], asOf)
          // The model always appends (empty) sponsor rows; they never belong in a cross-firm view.
          .filter((r) => r.provenance === "scraped")
          .map((r) => ({
          metricId: r.metricId,
          label: r.label,
          unit: r.unit,
          value: r.value,
          asOf: r.asOf,
          change4w: r.change4w,
          sourceUrl: r.sourceUrl,
          provenanceLabel: r.provenanceLabel,
          missingReason: r.missingReason ?? null,
        }));
        return { status: "ok", rows };
      } catch (err) {
        console.error(`[vc] indicators unavailable for ${company.id}`, err);
        return { status: "unavailable", rows: [] };
      }
    },
  };
}
