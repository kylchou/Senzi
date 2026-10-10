"use client";

import { useId, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, EyeOff, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";
import { formatDate, formatShare } from "@/lib/market-view/format";
import { DEFAULT_LAYOUT, moveWidget, parseLayout, toggleWidget, WIDGETS, type ProfileLayout, type WidgetId } from "@/lib/profile/layout";

export interface PositionRow {
  id: string;
  question: string;
  href: string | null;
  side: "YES" | "NO";
  amount: number;
  shares: number | null;
  entry: number | null;
  now: number | null;
  result: "won" | "lost" | "void" | "pending";
  net: number | null;
  acceptedAt: string;
}

export interface ActivityRow {
  id: string;
  label: string;
  question: string | null;
  delta: number;
  balanceAfter: number;
  at: string;
}

export interface DashboardData {
  balance: number;
  netResult: number;
  won: number;
  lost: number;
  voided: number;
  inPlay: number;
  open: PositionRow[];
  awaiting: PositionRow[];
  settled: PositionRow[];
  /** Oldest first. */
  activity: ActivityRow[];
}

// --- Saved layout -------------------------------------------------------------

const KEY = "senzi-profile-layout-v1";
const EVENT = "senzi-profile-layout";
let cache: { raw: string | null; layout: ProfileLayout } = { raw: null, layout: DEFAULT_LAYOUT };

function readLayout(): ProfileLayout {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (raw !== cache.raw) cache = { raw, layout: parseLayout(raw) };
  return cache.layout;
}

function saveLayout(layout: ProfileLayout | null) {
  try {
    if (layout) localStorage.setItem(KEY, JSON.stringify(layout));
    else localStorage.removeItem(KEY);
  } catch {
    // Blocked storage: the change lasts until the page reloads.
    cache = { raw: "unsaved", layout: layout ?? DEFAULT_LAYOUT };
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// --- Dashboard ----------------------------------------------------------------

export function ProfileDashboard({ data }: { data: DashboardData }) {
  const layout = useSyncExternalStore(subscribe, readLayout, () => DEFAULT_LAYOUT);
  const [customizing, setCustomizing] = useState(false);
  const panelId = useId();
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));

  return (
    <div className="space-y-8">
      <div>
        <Button variant="outline" size="sm" aria-expanded={customizing} aria-controls={panelId} onClick={() => setCustomizing((c) => !c)}>
          <SlidersHorizontal className="size-3.5" aria-hidden /> {customizing ? "Done" : "Customize dashboard"}
        </Button>
        {customizing && <Customize id={panelId} layout={layout} />}
      </div>

      {visible.length === 0 && <p className="text-sm text-ink-600">Every section is hidden. Use Customize dashboard to show some.</p>}
      {visible.map((id) => (
        <Widget key={id} id={id} data={data} />
      ))}
    </div>
  );
}

function Customize({ id, layout }: { id: string; layout: ProfileLayout }) {
  return (
    <div id={id} className="surface-card mt-3 max-w-xl p-4">
      <p className="text-sm text-ink-600">Show, hide, and reorder sections. Saved in this browser.</p>
      <ul className="mt-3 divide-y divide-hairline">
        {layout.order.map((w, i) => {
          const shown = !layout.hidden.includes(w);
          return (
            <li key={w} className="flex items-center justify-between gap-3 py-2">
              <span className={cn("text-sm font-medium", shown ? "text-ink-900" : "text-ink-500 line-through")}>{WIDGETS[w]}</span>
              <span className="flex gap-1">
                <IconButton label={`${shown ? "Hide" : "Show"} ${WIDGETS[w]}`} pressed={shown} onClick={() => saveLayout(toggleWidget(layout, w))}>
                  {shown ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                </IconButton>
                <IconButton label={`Move ${WIDGETS[w]} up`} disabled={i === 0} onClick={() => saveLayout(moveWidget(layout, w, -1))}>
                  <ArrowUp className="size-4" aria-hidden />
                </IconButton>
                <IconButton label={`Move ${WIDGETS[w]} down`} disabled={i === layout.order.length - 1} onClick={() => saveLayout(moveWidget(layout, w, 1))}>
                  <ArrowDown className="size-4" aria-hidden />
                </IconButton>
              </span>
            </li>
          );
        })}
      </ul>
      <button type="button" onClick={() => saveLayout(null)} className="mt-2 text-sm font-semibold text-ink-700 hover:text-ink-900 hover:underline">
        Reset to default
      </button>
    </div>
  );
}

function IconButton({ label, pressed, disabled, onClick, children }: { label: string; pressed?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-full text-ink-700 hover:bg-ink-100 hover:text-ink-900 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function Widget({ id, data }: { id: WidgetId; data: DashboardData }) {
  switch (id) {
    case "summary":
      return <Summary data={data} />;
    case "balance":
      return <BalanceChart activity={data.activity} />;
    case "open":
      return <Positions title={WIDGETS.open} items={data.open} empty="Nothing open right now." />;
    case "awaiting":
      return <Positions title={WIDGETS.awaiting} items={data.awaiting} empty="Nothing waiting on a result." />;
    case "settled":
      return <Settled items={data.settled} />;
    case "activity":
      return <Activity items={data.activity} />;
  }
}

// --- Sections -----------------------------------------------------------------

const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString()}`;
const tone = (n: number) => (n > 0 ? "text-emerald-700 dark:text-emerald-300" : n < 0 ? "text-red-700" : "text-ink-900");

function Summary({ data }: { data: DashboardData }) {
  const decided = data.won + data.lost;
  return (
    <section aria-label={WIDGETS.summary}>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Balance" value={`${data.balance.toLocaleString()} credits`} />
        <Stat label="Lifetime profit/loss" value={`${signed(data.netResult)} credits`} className={tone(data.netResult)} hint="Payouts minus credits spent, on settled forecasts" />
        <Stat
          label="Record"
          value={`${data.won} won · ${data.lost} lost`}
          hint={decided ? `${Math.round((data.won / decided) * 100)}% won${data.voided ? ` · ${data.voided} voided` : ""}` : "No settled forecasts yet"}
        />
        <Stat label="In open forecasts" value={`${data.inPlay.toLocaleString()} credits`} />
      </dl>
    </section>
  );
}

function Stat({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className="surface-card p-5">
      <dt className="text-xs text-ink-600">{label}</dt>
      <dd className={cn("mt-1 font-display text-2xl font-bold tabular-nums text-ink-900", className)}>{value}</dd>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

function BalanceChart({ activity }: { activity: ActivityRow[] }) {
  const titleId = useId();
  if (activity.length < 2) {
    return (
      <Section title={WIDGETS.balance}>
        <p className="text-sm text-ink-600">Your balance chart appears after a little more activity.</p>
      </Section>
    );
  }
  const values = activity.map((a) => a.balanceAfter);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const w = 600;
  const h = 140;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => (max === min ? h / 2 : h - 8 - ((v - min) / (max - min)) * (h - 16));
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const first = values[0]!;
  const last = values.at(-1)!;
  const change = last - first;

  return (
    <Section title={WIDGETS.balance}>
      <div className="surface-card p-5">
        <p id={titleId} className="text-sm text-ink-600">
          <span className="font-semibold text-ink-900">{last.toLocaleString()} credits</span> now ·{" "}
          <span className={tone(change)}>{signed(change)}</span> since {formatDate(activity[0]!.at)}
        </p>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-3 h-32 w-full" role="img" aria-labelledby={titleId}>
          <path d={`${line} L${w} ${h} L0 ${h} Z`} className="fill-red-500/10" />
          <path d={line} fill="none" className="stroke-red-500" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        </svg>
        <p className="mt-1 flex justify-between text-xs text-ink-500">
          <span>Low {min.toLocaleString()}</span>
          <span>High {max.toLocaleString()}</span>
        </p>
      </div>
    </Section>
  );
}

const RESULT = { won: "Won", lost: "Lost", void: "Voided", pending: "Open" } as const;

function Positions({ title, items, empty }: { title: string; items: PositionRow[]; empty: string }) {
  return (
    <Section title={title} count={items.length}>
      {items.length === 0 ? (
        <p className="text-sm text-ink-600">{empty}</p>
      ) : (
        <ul className="grid gap-3">
          {items.map((pos) => (
            <li key={pos.id} className="surface-card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                {pos.href ? (
                  <Link href={pos.href} className="font-medium text-ink-900 hover:underline">
                    {pos.question}
                  </Link>
                ) : (
                  <p className="font-medium text-ink-900">{pos.question}</p>
                )}
                <p className="mt-1 text-sm text-ink-600">
                  <strong className={pos.side === "YES" ? "text-red-700" : "text-ink-900"}>{pos.side}</strong> · {pos.amount} credits
                  {pos.shares !== null ? ` · ${pos.shares.toFixed(1)} shares` : ""}
                  {pos.entry !== null ? ` · entered at ${formatShare(pos.entry)}` : ""} · {formatDate(pos.acceptedAt)}
                </p>
              </div>
              <div className="shrink-0 text-left tabular-nums sm:text-right">
                <p className="text-sm font-semibold text-ink-900">{RESULT[pos.result]}</p>
                {pos.net !== null ? (
                  <p className={cn("text-sm", tone(pos.net))}>{signed(pos.net)} credits</p>
                ) : pos.now !== null ? (
                  <p className="text-sm text-ink-600">Now {formatShare(pos.now)}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

const FILTERS = [
  ["all", "All"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["void", "Voided"],
] as const;

function Settled({ items }: { items: PositionRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("all");
  const shown = filter === "all" ? items : items.filter((p) => p.result === filter);
  return (
    <div>
      {items.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter settled forecasts">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "h-8 rounded-full border px-3 text-sm font-medium transition-colors",
                filter === value ? "border-ink-900 bg-ink-900 text-surface" : "border-ink-200 text-ink-700 hover:bg-ink-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <Positions title={WIDGETS.settled} items={shown} empty={items.length ? "None match this filter." : "No settled forecasts yet."} />
    </div>
  );
}

function Activity({ items }: { items: ActivityRow[] }) {
  const recent = [...items].reverse().slice(0, 50);
  return (
    <Section title={WIDGETS.activity}>
      {recent.length === 0 ? (
        <p className="text-sm text-ink-600">No activity yet.</p>
      ) : (
        <ul className="surface-card divide-y divide-hairline">
          {recent.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-ink-900">{h.label}</p>
                {h.question && <p className="truncate text-ink-600">{h.question}</p>}
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <p className={cn("font-semibold", h.delta > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-ink-900")}>{signed(h.delta)}</p>
                <p className="text-xs text-ink-500">{formatDate(h.at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-xl font-bold text-ink-900">
        {title} {count !== undefined && <span className="text-base font-medium text-ink-500">({count})</span>}
      </h2>
      {children}
    </section>
  );
}
