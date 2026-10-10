import {
  ALLOCATION_SHARE_EXPLAINER,
  ALLOCATION_SHARE_LABEL,
  BASELINE_EXPLAINER,
  CALIBRATION_EXPLAINER,
} from "@/lib/vc/constants";
import { formatShare, type BaselineView, type Freshness } from "@/lib/vc/estimates";
import { formatDateTime } from "@/lib/vc/format";
import { describeCalibration } from "@/lib/vc/reports";
import type { MarketEstimate } from "@/lib/vc/types";

function Measure({
  label,
  value,
  kind,
  explainer,
  detail,
}: {
  label: string;
  value: string;
  kind: string;
  explainer: string;
  detail?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <dt className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</dt>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          {kind}
        </span>
      </div>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-50">{value}</dd>
      {detail && <dd className="text-xs text-slate-500 dark:text-slate-400">{detail}</dd>}
      <dd className="mt-2 text-xs leading-snug text-slate-500 dark:text-slate-400">{explainer}</dd>
    </div>
  );
}

/**
 * Shows the opening baseline, the community allocation share and the calibrated
 * probability as three separately labeled measurements.
 */
export function EstimateSummary({
  baseline,
  estimate,
  freshness,
}: {
  baseline: BaselineView;
  estimate: MarketEstimate | null;
  freshness: Freshness;
}) {
  const share = estimate?.allocation.yesShare ?? null;
  return (
    <div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Measure
          label="Opening baseline"
          kind="Reference"
          value={formatShare(baseline.value)}
          explainer={baseline.methodology ? `Method: ${baseline.methodology}` : BASELINE_EXPLAINER}
        />
        <Measure
          label={ALLOCATION_SHARE_LABEL}
          kind="Community"
          value={formatShare(share, 1)}
          detail={
            estimate
              ? `${estimate.allocation.yesCredits.toLocaleString()} YES / ${estimate.allocation.noCredits.toLocaleString()} NO virtual credits`
              : "No forecasts yet"
          }
          explainer={ALLOCATION_SHARE_EXPLAINER}
        />
        <Measure
          label="Calibrated probability"
          kind="Model"
          value={estimate?.calibratedProbability ? formatShare(estimate.calibratedProbability.value, 1) : "Not available"}
          detail={
            estimate?.calibratedProbability ? describeCalibration(estimate.calibratedProbability).trim() || undefined : undefined
          }
          explainer={CALIBRATION_EXPLAINER}
        />
      </dl>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>
          <strong className="font-medium text-slate-700 dark:text-slate-200">{estimate?.participantCount ?? 0}</strong>{" "}
          participants · <strong className="font-medium text-slate-700 dark:text-slate-200">{estimate?.forecastCount ?? 0}</strong>{" "}
          forecasts
        </span>
        <span>Data as of {formatDateTime(freshness.asOf)}</span>
        <span>Last forecast {formatDateTime(freshness.lastForecastAt)}</span>
        {freshness.isStale && (
          <span className="font-medium text-amber-700 dark:text-amber-300">⚠ {freshness.description}</span>
        )}
      </div>
    </div>
  );
}
