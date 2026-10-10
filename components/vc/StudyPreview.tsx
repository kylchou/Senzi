"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { vcFetch } from "@/lib/vc/client";
import { CROWD_PRICE_LABEL, DASHBOARD_MOVEMENT_WINDOW_MS, VERIFIED_PRICE_LABEL } from "@/lib/vc/constants";
import { formatPointChange, formatShare, seriesChangeOverWindow } from "@/lib/vc/estimates";
import { formatDate } from "@/lib/vc/format";
import type { StudyPreview as Preview } from "@/lib/vc/preview";
import type { EstimatePoint } from "@/lib/vc/types";
import { ProvenanceBadge, SOURCE_NAMES } from "./ProvenanceBadge";
import { StatusBadge } from "./StatusBadge";
import { ThreeLineChart } from "./ThreeLineChart";

type Num = number | null;
const diff = (a: Num, b: Num) => (a == null || b == null ? null : a - b);

function Big({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function Body({ p }: { p: Preview }) {
  const history: EstimatePoint[] = p.history.map((h) => ({ ...h, at: new Date(h.at) }));
  const now = new Date();
  const crowd7d = seriesChangeOverWindow(history, (h) => h.yesShare, DASHBOARD_MOVEMENT_WINDOW_MS, now);
  const verified7d = seriesChangeOverWindow(history, (h) => h.specializedPrice, DASHBOARD_MOVEMENT_WINDOW_MS, now);

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-3 gap-3">
        <Big label="Model" value={formatShare(p.model)} />
        <Big label={CROWD_PRICE_LABEL} value={formatShare(p.crowd, 1)} />
        <Big label={VERIFIED_PRICE_LABEL} value={formatShare(p.verified, 1)} />
      </dl>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
        {[
          ["Model vs crowd", formatPointChange(diff(p.model, p.crowd))],
          ["Verified vs crowd", formatPointChange(diff(p.verified, p.crowd))],
          ["Crowd, 7 days", formatPointChange(crowd7d)],
          ["Verified, 7 days", formatPointChange(verified7d)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>

      <ThreeLineChart marketId={p.marketId ?? p.id} points={history} baseline={null} />

      <div>
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Model sources</h3>
        {p.sources.length === 0 ? (
          <p className="text-sm text-slate-500">No model inputs recorded yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {p.sources.map((s) => (
              <li key={`${s.label}:${s.source}`} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {s.label}
                  <span className="text-slate-500"> · </span>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-slate-600 underline underline-offset-2 dark:text-slate-300">
                      {SOURCE_NAMES[s.source] ?? s.source}
                    </a>
                  ) : (
                    <span className="text-slate-600 dark:text-slate-300">{SOURCE_NAMES[s.source] ?? s.source}</span>
                  )}
                </span>
                <ProvenanceBadge provenance={s.provenance} simulated={s.simulated} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The question text in a study row. Clicking it (or anywhere on the row, via
 * the overlay) opens a preview dialog; the dialog links to the full report.
 */
export function StudyPreviewTrigger({ studyId, question }: { studyId: string; question: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Leaving the page (or Next hiding it for back/forward) must not leave the dialog open for when the page returns.
  useEffect(() => {
    const d = dialogRef.current;
    return () => {
      if (d?.open) d.close();
      setOpen(false);
    };
  }, []);

  function show() {
    setOpen(true);
    if (preview) return;
    setError(null);
    vcFetch<Preview>(`/api/studies/${studyId}/preview`)
      .then(setPreview)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Couldn't load the preview."));
  }

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-haspopup="dialog"
        className="text-left font-medium text-slate-900 before:absolute before:inset-0 before:cursor-pointer hover:underline dark:text-slate-100"
      >
        {question}
      </button>
      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        aria-labelledby={`preview-${studyId}`}
        className="m-auto w-[min(44rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
      >
        {open && (
          <div className="max-h-[85vh] overflow-y-auto p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                {preview && (
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <StatusBadge status={preview.status} />
                    {preview.startupName && <span>{preview.startupName}</span>}
                    <span>· Deadline {formatDate(preview.deadline)}</span>
                    <span>· {preview.participants} participants</span>
                  </div>
                )}
                <h2 id={`preview-${studyId}`} className="text-lg font-semibold leading-snug">
                  {question}
                </h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close preview" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="size-4" aria-hidden />
              </button>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-rose-700">{error}</p>
            ) : preview ? (
              <Body p={preview} />
            ) : (
              <div className="space-y-3" aria-busy="true" aria-label="Loading preview">
                <div className="h-14 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-48 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            )}

            <div className="mt-5 flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
              <Link
                href={`/vc/studies/${studyId}`}
                onClick={() => setOpen(false)}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
              >
                Open full report
              </Link>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
