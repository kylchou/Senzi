"use client";

import Link from "next/link";
import { useState } from "react";
import { VcApiError, vcFetch } from "@/lib/vc/client";
import { ALERT_TYPE_LABELS, formatRelative } from "@/lib/vc/format";
import type { VcAlert } from "@/lib/vc/types";
import { EmptyState } from "./EmptyState";
import { buttonSecondary, errorClass } from "./styles";

/**
 * Alert feed with mark-read. `compact` (dashboard) drops the header controls
 * and uses a shorter empty state.
 */
export function AlertList({
  initialAlerts,
  compact = false,
  emptyText,
}: {
  initialAlerts: VcAlert[];
  compact?: boolean;
  emptyText?: string;
}) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [error, setError] = useState<string | null>(null);
  const unread = alerts.filter((a) => !a.readAt);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setError(null);
    try {
      await vcFetch("/api/vc/alerts", { method: "PATCH", json: { alertIds: ids } });
      const now = new Date();
      setAlerts((all) => all.map((a) => (ids.includes(a.id) ? { ...a, readAt: now } : a)));
    } catch (err) {
      setError(err instanceof VcApiError ? err.message : "Could not update alerts");
    }
  }

  if (alerts.length === 0) {
    if (compact) return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyText ?? "No unread alerts."}</p>;
    return (
      <EmptyState title="No alerts" action={{ href: "/vc/companies", label: "Follow companies" }}>
        {emptyText ??
          "Alerts appear for significant forecast movements, upcoming deadlines and resolutions on studies and startups you follow."}
      </EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-600 dark:text-slate-300">{unread.length} unread</p>
          <button type="button" className={buttonSecondary} disabled={unread.length === 0} onClick={() => markRead(unread.map((a) => a.id))}>
            Mark all read
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={errorClass}>
          {error}
        </p>
      )}
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950">
        {alerts.map((a) => {
          const t = ALERT_TYPE_LABELS[a.type];
          return (
            <li key={a.id} className={`flex gap-3 p-3 ${a.readAt ? "" : "bg-sky-50/60 dark:bg-sky-950/30"}`}>
              <span aria-hidden className="mt-0.5 w-5 text-center text-slate-500">
                {t.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium">{t.label}</span>
                  <span>{formatRelative(a.createdAt)}</span>
                  {!a.readAt && <span className="font-semibold text-sky-700 dark:text-sky-300">New</span>}
                </div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{a.title}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300">{a.body}</p>
                <div className="mt-1 flex gap-3 text-xs">
                  {a.studyId && (
                    <Link href={`/vc/studies/${a.studyId}`} className="text-slate-700 underline dark:text-slate-200" onClick={() => !a.readAt && markRead([a.id])}>
                      View study
                    </Link>
                  )}
                  {!a.readAt && (
                    <button type="button" className="text-slate-500 hover:underline" onClick={() => markRead([a.id])}>
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
