import { STATUS_LABELS, VISIBILITY_LABELS } from "@/lib/vc/format";
import type { StudyStatus, StudyVisibility } from "@/lib/vc/types";

const STATUS_STYLES: Record<StudyStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600",
  SUBMITTED: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800",
  APPROVED: "bg-indigo-50 text-indigo-800 ring-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:ring-indigo-800",
  OPEN: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800",
  CLOSED: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800",
  RESOLVED: "bg-violet-50 text-violet-800 ring-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:ring-violet-800",
  REJECTED: "bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-800",
  CANCELLED: "bg-slate-100 text-slate-500 ring-slate-200 line-through dark:bg-slate-900 dark:text-slate-400 dark:ring-slate-700",
};

const pill = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset";

export function StatusBadge({ status }: { status: StudyStatus }) {
  return <span className={`${pill} ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function VisibilityBadge({ visibility }: { visibility: StudyVisibility }) {
  const { label, description } = VISIBILITY_LABELS[visibility];
  return (
    <span
      title={description}
      className={`${pill} bg-white text-slate-600 ring-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-600`}
    >
      {visibility === "PUBLIC" ? "◯" : "◉"}&nbsp;{label}
    </span>
  );
}
