"use client";

import { X } from "lucide-react";
import { formatCredits, formatLongDate, formatShortDate } from "@/lib/market-view/format";
import { recentActivity, SERIES, type ReplayData, type ReplayEvent, type ReplayPoint } from "@/lib/market-view/replay";
import { cn } from "../cn";
import { ExternalLink } from "../ExternalLink";
import { Illustration } from "../Illustration";
import { percent, SERIES_STYLE } from "./series";

const ORIGIN_LABEL: Record<ReplayEvent["origin"], string> = {
  real: "From market records",
  derived: "Detected from forecast history",
  demo: "Demo data, illustrative only",
};

/** Compact details for the selected event. */
export function ReplayEventPanel({ event, onClose }: { event: ReplayEvent; onClose: () => void }) {
  return (
    <section aria-label="Selected event" className="relative animate-[rise-in_240ms_var(--ease-out-soft)]">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close event"
        className="absolute -right-1 -top-1 rounded-full p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-900"
      >
        <X className="size-3.5" aria-hidden />
      </button>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-red-700">{formatShortDate(event.at)}</p>
      <h3 className="mt-1 pr-6 font-display text-base font-semibold leading-snug text-ink-900">{event.title}</h3>
      {event.detail && <p className="mt-1 text-sm text-ink-600">{event.detail}</p>}
      <p className="mt-2 text-xs text-ink-500">{ORIGIN_LABEL[event.origin]}</p>
      {event.url && (
        <ExternalLink href={event.url} className="mt-2 text-sm">
          Source
        </ExternalLink>
      )}
    </section>
  );
}

/** All events as a list, so they are reachable without the timeline markers. */
export function ReplayEventList({
  events,
  time,
  selectedId,
  onSelect,
}: {
  events: ReplayEvent[];
  time: number;
  selectedId: string | null;
  onSelect: (event: ReplayEvent) => void;
}) {
  if (events.length === 0) return <p className="text-sm text-ink-500">No events recorded for this market yet.</p>;
  return (
    <ol className="space-y-0.5">
      {events.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            onClick={() => onSelect(event)}
            className={cn(
              "flex w-full items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-ink-100",
              event.id === selectedId && "bg-ink-100",
              event.at > time && "text-ink-500",
            )}
          >
            <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tabular-nums text-ink-500">
              {formatShortDate(event.at)}
            </span>
            <span className="min-w-0 flex-1 truncate">{event.title}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Aggregated forecasts in the day before the replayed moment. */
export function ReplayActivity({ data, time }: { data: ReplayData; time: number }) {
  const recent = recentActivity(data.activity, time);
  if (!recent) return <p className="text-sm text-ink-500">Forecast activity is not available for this market.</p>;
  const total = recent.yes + recent.no;
  return (
    <div className="text-sm">
      {total === 0 ? (
        <p className="text-ink-500">No forecasts in the 24 hours before this moment.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 tabular-nums">
          <dt className="text-ink-600">YES forecasts</dt>
          <dd className="text-right font-semibold text-ink-900">
            {recent.yes} <span className="font-normal text-ink-500">({formatCredits(recent.yesCredits)} cr)</span>
          </dd>
          <dt className="text-ink-600">NO forecasts</dt>
          <dd className="text-right font-semibold text-ink-900">
            {recent.no} <span className="font-normal text-ink-500">({formatCredits(recent.noCredits)} cr)</span>
          </dd>
          <dt className="text-ink-600">From verified users</dt>
          <dd className="text-right font-semibold text-ink-900">{recent.verified}</dd>
        </dl>
      )}
      <p className="mt-2 text-xs text-ink-500">In the 24 hours before {formatShortDate(time)}</p>
    </div>
  );
}

/** Shown over the chart when a resolved market's replay reaches its end. */
export function ResolvedCard({ data, final }: { data: ReplayData; final: ReplayPoint | null }) {
  if (!data.resolution) return null;
  const { outcome, resolvedAt, evidenceUrl } = data.resolution;
  return (
    <div className="pointer-events-auto absolute right-3 top-3 w-64 animate-[rise-in_320ms_var(--ease-out-soft)] rounded-2xl bg-ink-900 p-4 text-surface shadow-[var(--shadow-lift)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-300">Market resolved</p>
      <p className="mt-1 font-display text-3xl font-bold">{outcome === "VOID" ? "VOID" : outcome}</p>
      <p className="text-xs text-ink-300">{formatLongDate(resolvedAt)}</p>
      <dl className="mt-3 space-y-1 text-sm tabular-nums">
        {SERIES.map((series) => (
          <div key={series} className="flex justify-between">
            <dt className="text-ink-300">{SERIES_STYLE[series].label}</dt>
            <dd className="font-semibold">{percent(final?.[series] ?? null)}</dd>
          </div>
        ))}
      </dl>
      {evidenceUrl && (
        <ExternalLink href={evidenceUrl} className="mt-3 text-sm text-surface decoration-surface/30">
          Resolution evidence
        </ExternalLink>
      )}
    </div>
  );
}

export function ReplayEmptyState({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-surface/60 px-6 py-12 text-center">
      <Illustration name="markets" />
      <p className="mt-2 font-display font-semibold text-ink-900">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-600">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
