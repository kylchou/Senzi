import { InfoTip } from "@/components/ui/InfoTip";
import {
  CROWD_PRICE_DEFINITION,
  CROWD_PRICE_LABEL,
  DASHBOARD_MOVEMENT_WINDOW_MS,
  MODEL_DEFINITION,
  VERIFIED_PRICE_DEFINITION,
  VERIFIED_PRICE_LABEL,
} from "@/lib/vc/constants";
import { formatPointChange, seriesChangeOverWindow } from "@/lib/vc/estimates";
import type { EstimatePoint, MarketEstimate } from "@/lib/vc/types";

type Num = number | null | undefined;

const diff = (a: Num, b: Num) => (a == null || b == null ? null : a - b);

/** "Model is 22.3 pts above the crowd", or why there's no number. */
function describeGap(gap: number | null, a: string, b: string, missing: string) {
  if (gap == null) return missing;
  const pts = Math.abs(gap * 100).toFixed(1);
  if (pts === "0.0") return `${a} and ${b} agree.`;
  return `${a} is ${pts} pts ${gap > 0 ? "above" : "below"} ${b}.`;
}

function Stat({ label, value, note, tip }: { label: string; value: string; note: string; tip?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
      <dt className="flex items-center gap-0.5 text-xs text-slate-500 dark:text-slate-400">
        {label}
        {tip && <InfoTip label={`About ${label}`}>{tip}</InfoTip>}
      </dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</dd>
      <dd className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{note}</dd>
    </div>
  );
}

/**
 * The gaps between the three lines (the part a VC reads) and how the crowd
 * and verified-user prices moved over the last 7 days, each named.
 */
export function MarketGaps({ estimate, history, now }: { estimate: MarketEstimate | null; history: EstimatePoint[]; now: Date }) {
  const last = history.at(-1);
  const model = estimate?.modelValue ?? last?.modelValue ?? estimate?.openingBaseline?.value ?? null;
  const crowd = estimate?.generalPrice ?? last?.yesShare ?? null;
  const verified = estimate?.specializedPrice ?? last?.specializedPrice ?? null;
  const noVerified = "No verified-user trades yet.";
  const crowd7d = seriesChangeOverWindow(history, (p) => p.yesShare, DASHBOARD_MOVEMENT_WINDOW_MS, now);
  const verified7d = seriesChangeOverWindow(history, (p) => p.specializedPrice, DASHBOARD_MOVEMENT_WINDOW_MS, now);
  const moved = (d: number | null, who: string, missing: string) =>
    d == null ? missing : `${who} ${d > 0 ? "rose" : d < 0 ? "fell" : "held"} over the last 7 days.`;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Gaps now</h3>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Stat
            label={`Model vs ${CROWD_PRICE_LABEL.toLowerCase()}`}
            value={formatPointChange(diff(model, crowd))}
            note={describeGap(diff(model, crowd), "Model", "the crowd", "Needs both a model value and trades.")}
            tip={`Does the crowd disagree with the numbers? ${MODEL_DEFINITION}`}
          />
          <Stat
            label={`Verified vs ${CROWD_PRICE_LABEL.toLowerCase()}`}
            value={formatPointChange(diff(verified, crowd))}
            note={describeGap(diff(verified, crowd), "Verified users", "the crowd", noVerified)}
            tip={`Do people who use the product see it differently from everyone else? ${VERIFIED_PRICE_DEFINITION}`}
          />
          <Stat
            label="Model vs verified"
            value={formatPointChange(diff(model, verified))}
            note={describeGap(diff(model, verified), "Model", "verified users", noVerified)}
            tip="Do the product's own users disagree with the numbers?"
          />
        </dl>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">7-day change</h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Stat
            label={CROWD_PRICE_LABEL}
            value={formatPointChange(crowd7d)}
            note={moved(crowd7d, CROWD_PRICE_LABEL, "Not enough history to compare 7 days back.")}
            tip={CROWD_PRICE_DEFINITION}
          />
          <Stat
            label={VERIFIED_PRICE_LABEL}
            value={formatPointChange(verified7d)}
            note={moved(verified7d, VERIFIED_PRICE_LABEL, verified == null ? noVerified : "Not enough history to compare 7 days back.")}
            tip={VERIFIED_PRICE_DEFINITION}
          />
        </dl>
      </div>
    </div>
  );
}
