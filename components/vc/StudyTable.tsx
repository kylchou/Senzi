import Link from "next/link";
import { formatPointChange, formatShare } from "@/lib/vc/estimates";
import { formatDate } from "@/lib/vc/format";
import type { StudyView } from "@/lib/vc/permissions";
import type { MarketEstimate } from "@/lib/vc/types";
import { StatusBadge, VisibilityBadge } from "./StatusBadge";

export interface StudyRow {
  study: StudyView;
  estimate: MarketEstimate | null;
  startupName?: string | null;
  baselineValue?: number | null;
  change7d?: number | null;
}

/** Compact study list. Baseline and allocation share are separate columns by design. */
export function StudyTable({ rows, showChange = false }: { rows: StudyRow[]; showChange?: boolean }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="text-xs text-slate-500 dark:text-slate-400">
          <tr className="border-b border-slate-200 dark:border-slate-800">
            <th className="px-4 py-2 font-medium sm:px-2">Question</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 text-right font-medium">Model</th>
            <th className="px-2 py-2 text-right font-medium" title="General LMSR price — not a calibrated probability">
              General LMSR
            </th>
            <th className="px-2 py-2 text-right font-medium">Verified LMSR</th>
            <th className="px-2 py-2 text-right font-medium">Model − general / Verified − general</th>
            <th className="px-2 py-2 font-medium">Outcome / evidence</th>
            {showChange && <th className="px-2 py-2 text-right font-medium">7d change</th>}
            <th className="px-2 py-2 text-right font-medium">Participants</th>
            <th className="px-4 py-2 text-right font-medium sm:px-2">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ study, estimate, startupName, baselineValue, change7d }) => (
            <tr key={study.id} className="border-b border-slate-100 align-top last:border-0 dark:border-slate-900">
              <td className="px-4 py-2 sm:px-2">
                <Link
                  href={`/vc/studies/${study.id}`}
                  className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                >
                  {study.question}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  {startupName && <span>{startupName}</span>}
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
              <td className="px-2 py-2 text-right">{estimate?.specializedPrice == null ? <span className="text-xs text-slate-500">No verified-user data yet</span> : formatShare(estimate.specializedPrice,1)}</td>
              <td className="px-2 py-2 text-right text-xs">{formatPointChange(estimate?.modelValue != null && estimate.generalPrice != null ? estimate.modelValue-estimate.generalPrice : null)} / {formatPointChange(estimate?.specializedPrice != null && estimate.generalPrice != null ? estimate.specializedPrice-estimate.generalPrice : null)}</td>
              <td className="px-2 py-2 text-xs">{estimate?.resolution?.outcome ?? study.resolvedOutcome ?? "Pending"}{estimate?.resolution?.evidenceUrls.map((url,i)=><a key={url} className="block underline" href={url} target="_blank" rel="noreferrer">Evidence {i+1}</a>)}</td>
              {showChange && <td className="px-2 py-2 text-right tabular-nums">{formatPointChange(change7d)}</td>}
              <td className="px-2 py-2 text-right tabular-nums">{estimate?.participantCount ?? "—"}{estimate && estimate.participantCount < 10 && <span className="block text-xs text-amber-700">Low participation</span>}</td>
              <td className="px-4 py-2 text-right sm:px-2">{formatDate(study.deadline)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
