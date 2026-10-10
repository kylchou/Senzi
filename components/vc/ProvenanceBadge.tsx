import type { Provenance, SourceId } from "@/lib/model/types";

/** Plain names for where a data point came from. */
export const SOURCE_NAMES: Record<SourceId, string> = {
  npm: "npm registry",
  pypistats: "PyPI Stats",
  github: "GitHub API",
  sec_edgar: "SEC EDGAR",
  greenhouse: "Greenhouse job board",
  ashby: "Ashby job board",
  workable: "Workable job board",
  tranco: "Tranco top-sites list",
  hn_algolia: "Hacker News (Algolia)",
  sponsor: "Your firm",
};

const TONE = {
  scraped: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-900",
  sponsor_provided: "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-900",
  simulated: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-900",
} as const;

const pill = "inline-block shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset";

/**
 * Says whether a figure was scraped from a public source or provided by the
 * sponsor (which controls it), and whether it is simulated demo data. Used
 * everywhere either kind of data appears, so the two are never mixed up.
 */
export function ProvenanceBadge({ provenance, simulated = false }: { provenance: Provenance; simulated?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <span className={`${pill} ${TONE[provenance]}`}>{provenance === "scraped" ? "Scraped · public" : "Sponsor-provided"}</span>
      {simulated && <span className={`${pill} ${TONE.simulated}`}>Simulated</span>}
    </span>
  );
}
