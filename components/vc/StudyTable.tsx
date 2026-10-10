import Link from "next/link";
import { InfoTip } from "@/components/ui/InfoTip";
import {
  CROWD_PRICE_DEFINITION,
  CROWD_PRICE_LABEL,
  MODEL_DEFINITION,
  VERIFIED_PRICE_DEFINITION,
  VERIFIED_PRICE_LABEL,
} from "@/lib/vc/constants";
import { formatShare } from "@/lib/vc/estimates";
import { formatDate } from "@/lib/vc/format";
import type { StudyView } from "@/lib/vc/permissions";
import type { MarketEstimate } from "@/lib/vc/types";
import { StatusBadge, VisibilityBadge } from "./StatusBadge";

export interface StudyRow {
  study: StudyView;
  estimate: MarketEstimate | null;
  startupName?: string | null;
  /** Links the startup name to its company hub. */
  startupSlug?: string | null;
  baselineValue?: number | null;
}

function Th({ children, tip, label, align = "right" }: { children: string; tip?: string; label?: string; align?: "left" | "right" }) {
  return (
    <th className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : ""}`}>
      <span className="inline-flex items-center gap-0.5">
        {children}
        {tip && <InfoTip label={label ?? `What is ${children}?`}>{tip}</InfoTip>}
      </span>
    </th>
  );
}

/**
 * Compact study list. Each row opens the study, which shows all three lines,
 * the gaps between them, 7-day changes and the evidence behind the model.
 */
export function StudyTable({ rows }: { rows: StudyRow[] }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs text-slate-500 dark:text-slate-400">
          <tr className="border-b border-slate-200 dark:border-slate-800">
            <th className="px-4 py-2 font-medium sm:px-2">Question</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <Th tip={MODEL_DEFINITION}>Model</Th>
            <Th tip={CROWD_PRICE_DEFINITION}>{CROWD_PRICE_LABEL}</Th>
            <Th tip={VERIFIED_PRICE_DEFINITION}>{VERIFIED_PRICE_LABEL}</Th>
            <th className="px-2 py-2 font-medium">Outcome</th>
            <th className="px-2 py-2 text-right font-medium">Participants</th>
            <th className="px-4 py-2 text-right font-medium sm:px-2">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ study, estimate, startupName, startupSlug, baselineValue }) => (
            <tr
              key={study.id}
              className="relative border-b border-slate-100 align-top transition-colors last:border-0 hover:bg-slate-50 dark:border-slate-900 dark:hover:bg-slate-900/60"
            >
              <td className="px-4 py-2 sm:px-2">
                {/* The link's overlay covers the whole row, so clicking anywhere opens the study. */}
                <Link
                  href={`/vc/studies/${study.id}`}
                  className="font-medium text-slate-900 before:absolute before:inset-0 hover:underline dark:text-slate-100"
                >
                  {study.question}
                </Link>
                <div className="relative mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {startupName &&
                    (startupSlug ? (
                      <Link href={`/vc/companies/${startupSlug}`} className="hover:underline">
                        {startupName}
                      </Link>
                    ) : (
                      <span>{startupName}</span>
                    ))}
                  <VisibilityBadge visibility={study.visibility} />
                </div>
              </td>
              <td className="px-2 py-2">
                <StatusBadge status={study.status} />
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {(baselineValue ?? estimate?.openingBaseline?.value ?? study.baselineValue) == null && !study.marketId ? (
                  <span className="text-xs text-amber-700 dark:text-amber-300" title="The model can't set an opening line yet, so forecasting can't open">
                    Not enough data
                  </span>
                ) : (
                  formatShare(estimate?.modelValue ?? baselineValue ?? estimate?.openingBaseline?.value ?? study.baselineValue)
                )}
              </td>
              <td className="px-2 py-2 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">
                {formatShare(estimate?.generalPrice, 1)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {estimate?.specializedPrice == null ? (
                  <span className="text-xs text-slate-500">No verified trades yet</span>
                ) : (
                  formatShare(estimate.specializedPrice, 1)
                )}
              </td>
              <td className="px-2 py-2 text-xs">
                {estimate?.resolution?.outcome ?? study.resolvedOutcome ?? "Pending"}
                {estimate?.resolution?.evidenceUrls.map((url, i) => (
                  <a key={url} className="relative block underline" href={url} target="_blank" rel="noreferrer">
                    Evidence {i + 1}
                  </a>
                ))}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">
                {estimate?.participantCount ?? "—"}
                {estimate && estimate.participantCount < 10 && <span className="block text-xs text-amber-700">Low participation</span>}
              </td>
              <td className="px-4 py-2 text-right sm:px-2">{formatDate(study.deadline)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
